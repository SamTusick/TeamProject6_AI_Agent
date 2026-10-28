import io
from pathlib import Path
import tarfile
import tempfile
import unittest

import torch

from backend.speech.model import SpeechModel, features
from backend.speech.prepare import extract
from backend.speech.text import VOCABULARY, encode
from backend.speech.train import collate, ctc_loss
from backend.speech.transcribe import load_checkpoint


class SpeechModelTests(unittest.TestCase):
    def setUp(self):
        torch.set_num_threads(2)
        torch.manual_seed(42)

    def test_finite_gradient_update_and_checkpoint_round_trip(self):
        model = SpeechModel(hidden_size=16)
        inputs = features(torch.randn(16000))
        batch = collate([(inputs, torch.tensor(encode("hello")), "hello")])
        before = model.classifier.weight.detach().clone()
        loss, _, _, _ = ctc_loss(model, batch, "cpu")
        loss.backward()
        self.assertTrue(all(torch.isfinite(parameter.grad).all() for parameter in model.parameters()))
        torch.optim.Adam(model.parameters(), lr=0.001).step()
        self.assertFalse(torch.equal(before, model.classifier.weight))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "checkpoint.pt"
            torch.save({"state_dict": model.state_dict(), "hidden_size": 16, "vocabulary": VOCABULARY, "sample_rate": 16000}, path)
            restored = load_checkpoint(path)
            self.assertTrue(torch.equal(model(inputs[None], torch.tensor([len(inputs)]))[0], restored(inputs[None], torch.tensor([len(inputs)]))[0]))

    def test_padding_does_not_change_valid_output(self):
        model = SpeechModel(hidden_size=16).eval()
        inputs = features(torch.randn(16000))
        alone, lengths = model(inputs[None], torch.tensor([len(inputs)]))
        batch = torch.nn.utils.rnn.pad_sequence([inputs, features(torch.randn(32000))], batch_first=True)
        combined, _ = model(batch, torch.tensor([len(inputs), 201]))
        self.assertTrue(torch.allclose(alone[0], combined[0, :lengths[0]], atol=1e-5))

    def test_archive_path_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "unsafe.tar.gz"
            with tarfile.open(archive, "w:gz") as bundle:
                entry = tarfile.TarInfo("../escape.txt")
                entry.size = 4
                bundle.addfile(entry, io.BytesIO(b"test"))
            with self.assertRaises(ValueError):
                extract(archive, root / "data")


if __name__ == "__main__":
    unittest.main()