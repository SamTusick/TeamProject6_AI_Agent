import argparse
import json
from pathlib import Path
import random

from jiwer import cer, wer
import soundfile
import torch
from torch.nn.utils.rnn import pad_sequence
from torch.utils.data import DataLoader, Dataset

from backend.speech.model import SpeechModel, features
from backend.speech.text import VOCABULARY, decode_ctc, encode


class SpeechDataset(Dataset):
    def __init__(self, root, split, limit, seed):
        self.root = root
        self.records = [
            record for record in json.loads((root / f"{split}.json").read_text(encoding="utf-8"))
            if 0.1 <= record["seconds"] <= 15 and record["text"]
        ]
        random.Random(seed).shuffle(self.records)
        if limit:
            self.records = self.records[:limit]
        if not self.records:
            raise ValueError(f"No usable examples in {split}; run backend.speech.prepare first.")

    def __len__(self):
        return len(self.records)

    def __getitem__(self, index):
        record = self.records[index]
        waveform, sample_rate = soundfile.read(self.root / record["audio"], dtype="float32")
        if sample_rate != 16000:
            raise ValueError("Training audio must be 16 kHz.")
        return features(waveform), torch.tensor(encode(record["text"])), record["text"]


def collate(batch):
    inputs, targets, texts = zip(*batch)
    return (
        pad_sequence(inputs, batch_first=True),
        torch.tensor([len(item) for item in inputs]),
        torch.cat(targets),
        torch.tensor([len(item) for item in targets]),
        list(texts),
    )


def ctc_loss(model, batch, device):
    inputs, lengths, targets, target_lengths, texts = batch
    probabilities, output_lengths = model(inputs.to(device), lengths)
    loss = torch.nn.functional.ctc_loss(
        probabilities.transpose(0, 1), targets.to(device), output_lengths,
        target_lengths, blank=0, zero_infinity=False,
    )
    if not torch.isfinite(loss):
        raise ValueError("Non-finite CTC loss; check audio/label lengths.")
    return loss, probabilities, output_lengths, texts


@torch.no_grad()
def evaluate(model, loader, device):
    model.eval()
    references, predictions = [], []
    loss_total = 0.0
    for batch in loader:
        loss, probabilities, lengths, texts = ctc_loss(model, batch, device)
        loss_total += loss.item() * len(texts)
        tokens = probabilities.argmax(dim=-1).cpu()
        predictions.extend(decode_ctc(tokens[index, :length]) for index, length in enumerate(lengths))
        references.extend(texts)
    return {
        "loss": loss_total / len(references),
        "wer": wer(references, predictions),
        "cer": cer(references, predictions),
        "utterances": len(references),
        "samples": [{"reference": reference, "prediction": prediction} for reference, prediction in zip(references[:3], predictions[:3])],
    }


def main():
    parser = argparse.ArgumentParser(description="Train a randomly initialized English CTC speech model.")
    parser.add_argument("--data", type=Path, default=Path(".models/speech/data"))
    parser.add_argument("--output", type=Path, default=Path(".models/speech/run"))
    parser.add_argument("--epochs", type=int, default=20)
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--max-train", type=int, default=0)
    parser.add_argument("--max-dev", type=int, default=0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--threads", type=int, default=4)
    parser.add_argument("--device", choices=["cpu", "cuda"], default="cpu")
    args = parser.parse_args()
    if min(args.epochs, args.batch_size, args.threads) < 1 or min(args.max_train, args.max_dev) < 0:
        parser.error("Epochs, batch size and threads must be positive; limits must be nonnegative.")
    if args.device == "cuda" and not torch.cuda.is_available():
        parser.error("CUDA is unavailable; select cpu or use an NVIDIA training machine.")
    torch.set_num_threads(args.threads)
    torch.manual_seed(args.seed)
    training = SpeechDataset(args.data, "train-clean-5", args.max_train, args.seed)
    development = SpeechDataset(args.data, "dev-clean-2", args.max_dev, args.seed)
    if {record["speaker"] for record in training.records} & {record["speaker"] for record in development.records}:
        raise ValueError("Training and development speakers overlap.")
    train_loader = DataLoader(training, batch_size=args.batch_size, shuffle=True, collate_fn=collate)
    dev_loader = DataLoader(development, batch_size=args.batch_size, collate_fn=collate)
    model = SpeechModel().to(args.device)
    optimizer = torch.optim.AdamW(model.parameters(), lr=0.001)
    args.output.mkdir(parents=True, exist_ok=True)
    if (args.output / "checkpoint.pt").exists():
        raise ValueError("Output already contains a checkpoint; use a new --output directory.")
    report = {
        "initialization": "random; no pretrained speech weights",
        "dataset": "OpenSLR 31 Mini LibriSpeech, CC BY 4.0",
        "torch_version": str(torch.__version__),
        "config": {key: str(value) if isinstance(value, Path) else value for key, value in vars(args).items()},
        "train_utterances": len(training),
        "development_ids": [record["id"] for record in development.records],
        "training_ids": [record["id"] for record in training.records],
        "baseline": evaluate(model, dev_loader, args.device),
        "epochs": [],
    }
    print(json.dumps({"baseline": report["baseline"]}), flush=True)
    for epoch in range(1, args.epochs + 1):
        model.train()
        loss_total = 0.0
        for step, batch in enumerate(train_loader, 1):
            optimizer.zero_grad(set_to_none=True)
            loss, _, _, texts = ctc_loss(model, batch, args.device)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimizer.step()
            loss_total += loss.item() * len(texts)
            if step % 25 == 0:
                print(f"epoch={epoch} batch={step}/{len(train_loader)} loss={loss.item():.4f}", flush=True)
        metrics = {"epoch": epoch, "train_loss": loss_total / len(training), "development": evaluate(model, dev_loader, args.device)}
        report["epochs"].append(metrics)
        temporary = args.output / "checkpoint.tmp"
        torch.save({
            "state_dict": model.state_dict(), "hidden_size": model.hidden_size,
            "vocabulary": VOCABULARY, "sample_rate": 16000, "epoch": epoch,
            "initialization": "random", "optimizer": optimizer.state_dict(),
        }, temporary)
        temporary.replace(args.output / "checkpoint.pt")
        (args.output / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(metrics), flush=True)


if __name__ == "__main__":
    main()