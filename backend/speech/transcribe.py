import argparse
from pathlib import Path

import soundfile
import torch

from backend.speech.model import SpeechModel, features
from backend.speech.text import VOCABULARY, decode_ctc


def load_checkpoint(path):
    checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if checkpoint["vocabulary"] != VOCABULARY or checkpoint["sample_rate"] != 16000:
        raise ValueError("Incompatible checkpoint vocabulary or sample rate.")
    model = SpeechModel(checkpoint["hidden_size"])
    model.load_state_dict(checkpoint["state_dict"])
    return model.eval()


@torch.no_grad()
def transcribe_waveform(waveform, model):
    inputs = features(waveform)
    probabilities, lengths = model(inputs.unsqueeze(0), torch.tensor([len(inputs)]))
    return decode_ctc(probabilities[0, :lengths[0]].argmax(dim=-1))


@torch.no_grad()
def transcribe_file(path, model):
    info = soundfile.info(path)
    if info.samplerate != 16000 or info.channels != 1 or not 0.025 <= info.duration <= 15:
        raise ValueError("Provide mono 16 kHz WAV/FLAC audio between 25 ms and 15 seconds.")
    waveform, _ = soundfile.read(path, dtype="float32")
    return transcribe_waveform(waveform, model)


def main():
    parser = argparse.ArgumentParser(description="Experimental inference using our own trained checkpoint.")
    parser.add_argument("audio", type=Path)
    parser.add_argument("--checkpoint", required=True, type=Path)
    args = parser.parse_args()
    torch.set_num_threads(4)
    print(transcribe_file(args.audio, load_checkpoint(args.checkpoint)))


if __name__ == "__main__":
    main()