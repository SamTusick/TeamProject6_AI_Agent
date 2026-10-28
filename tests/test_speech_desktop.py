from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import av
import numpy as np

from speech.desktop_worker import audio_chunks, process


class DesktopSpeechTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.audio = Path(self.directory.name) / "recording.webm"
        self.checkpoint = Path(self.directory.name) / "checkpoint.pt"
        self.checkpoint.touch()

    def write_webm(self, seconds=1):
        with av.open(str(self.audio), mode="w", format="webm") as container:
            stream = container.add_stream("libopus", rate=48000)
            stream.layout = "stereo"
            for offset in range(seconds * 50):
                sample_times = (np.arange(960) + offset * 960) / 48000
                signal = (0.1 * np.sin(2 * np.pi * 440 * sample_times)).astype(np.float32)
                frame = av.AudioFrame.from_ndarray(np.stack([signal, signal]), format="fltp", layout="stereo")
                frame.sample_rate = 48000
                frame.pts = offset * 960
                for packet in stream.encode(frame):
                    container.mux(packet)
            for packet in stream.encode(None):
                container.mux(packet)

    def test_webm_resamples_downmixes_and_splits(self):
        self.write_webm(seconds=16)
        chunks = list(audio_chunks(self.audio))
        self.assertEqual([len(chunk) for chunk in chunks], [240000, 16000])
        self.assertTrue(all(chunk.ndim == 1 and np.isfinite(chunk).all() for chunk in chunks))
        with patch("speech.desktop_worker.MAX_SAMPLES", 16000):
            with self.assertRaisesRegex(ValueError, "30 minutes"):
                list(audio_chunks(self.audio))

    def test_successful_predictions_are_joined(self):
        self.write_webm(seconds=16)
        predictions = iter(["send the report", "by friday"])
        result = process({"audioPath": str(self.audio), "backend": "checkpoint", "checkpoint": str(self.checkpoint)},
                         model_loader=lambda _: object(), predict=lambda *_: next(predictions))
        self.assertEqual(result, {"text": "send the report by friday"})

    def test_whisper_backend_needs_no_checkpoint_and_uses_30s_chunks(self):
        self.write_webm(seconds=16)
        sizes = []
        result = process({"audioPath": str(self.audio), "backend": "whisper"},
                         model_loader=lambda _: object(),
                         predict=lambda wave, _: sizes.append(len(wave)) or "hello")
        self.assertEqual(result, {"text": "hello"})
        self.assertEqual(sizes, [256000])

    def test_checkpoint_backend_still_requires_checkpoint(self):
        self.write_webm()
        with self.assertRaisesRegex(ValueError, "checkpoint is missing"):
            process({"audioPath": str(self.audio), "backend": "checkpoint",
                     "checkpoint": str(self.checkpoint) + ".gone"})

    def test_blank_output_is_explicit_failure(self):
        self.write_webm()
        with self.assertRaisesRegex(ValueError, "returned no words"):
            process({"audioPath": str(self.audio), "backend": "checkpoint", "checkpoint": str(self.checkpoint)},
                    model_loader=lambda _: object(), predict=lambda *_: "")

    def test_empty_recording_rejected_before_loading(self):
        self.audio.touch()
        with self.assertRaisesRegex(ValueError, "24 MB"):
            process({"audioPath": str(self.audio), "checkpoint": str(self.checkpoint)},
                    model_loader=lambda _: self.fail("Should not load the model"))


if __name__ == "__main__":
    unittest.main()