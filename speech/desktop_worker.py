import contextlib
import json
from pathlib import Path
import sys


MAX_AUDIO = 24_000_000
SAMPLE_RATE = 16000
CHUNK_SAMPLES = SAMPLE_RATE * 15
MAX_SAMPLES = SAMPLE_RATE * 30 * 60
EMPTY_RESULT = (
    "Our experimental model returned no words. Your recording and transcript "
    "are unchanged; the model needs more training."
)


def audio_chunks(audio_path):
    import av
    import numpy as np

    pending = np.empty(0, dtype=np.float32)
    total = 0
    with av.open(str(audio_path)) as container:
        if not container.streams.audio:
            raise ValueError("The recording contains no audio stream.")
        resampler = av.AudioResampler(format="fltp", layout="mono", rate=SAMPLE_RATE)

        def frames():
            for frame in container.decode(audio=0):
                yield from resampler.resample(frame)
            yield from resampler.resample(None)

        for frame in frames():
            samples = frame.to_ndarray().reshape(-1)
            total += len(samples)
            if total > MAX_SAMPLES:
                raise ValueError("Local transcription is limited to 30 minutes of audio.")
            pending = np.concatenate((pending, samples))
            while len(pending) >= CHUNK_SAMPLES:
                yield pending[:CHUNK_SAMPLES].copy()
                pending = pending[CHUNK_SAMPLES:]
        if len(pending):
            yield np.pad(pending, (0, max(0, 400 - len(pending))))


def process(request, model_loader=None, predict=None):
    import torch

    from speech.transcribe import load_checkpoint, transcribe_waveform

    audio_path = Path(request["audioPath"])
    checkpoint = Path(request["checkpoint"])
    if not audio_path.is_file() or not 0 < audio_path.stat().st_size <= MAX_AUDIO:
        raise ValueError("Audio must be between 1 byte and 24 MB.")
    if not checkpoint.is_file():
        raise ValueError("Our local speech checkpoint is missing. Train the model before transcribing.")
    torch.set_num_threads(4)
    model = (model_loader or load_checkpoint)(checkpoint)
    predictions = []
    size = 0
    for waveform in audio_chunks(audio_path):
        prediction = (predict or transcribe_waveform)(waveform, model).strip()
        if prediction:
            size += len(prediction) + 1
            if size > 100000:
                raise ValueError("Transcription exceeds the 100,000-character limit.")
            predictions.append(prediction)
    transcript = " ".join(predictions)
    if not transcript:
        raise ValueError(EMPTY_RESULT)
    return {"text": transcript}


def main():
    try:
        request = json.loads(sys.stdin.read(100000))
        with contextlib.redirect_stdout(sys.stderr):
            result = process(request)
        print(json.dumps(result))
    except ImportError:
        print(json.dumps({"error": "Local speech dependencies are missing. Install requirements-speech.txt and retry."}))
        sys.exit(1)
    except ValueError as error:
        print(json.dumps({"error": str(error)}))
        sys.exit(1)
    except Exception:
        print(json.dumps({"error": "Local transcription failed to decode the recording or load our checkpoint. Your recording and transcript are unchanged."}))
        sys.exit(1)


if __name__ == "__main__":
    main()