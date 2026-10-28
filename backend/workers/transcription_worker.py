import contextlib
import json
from pathlib import Path
import sys


MAX_AUDIO = 24_000_000
SAMPLE_RATE = 16000
CHUNK_SAMPLES = SAMPLE_RATE * 15
WHISPER_CHUNK_SAMPLES = SAMPLE_RATE * 30
MAX_SAMPLES = SAMPLE_RATE * 30 * 60
EMPTY_RESULT = (
    "Our experimental model returned no words. Your recording and transcript "
    "are unchanged; the model needs more training."
)
WHISPER_EMPTY_RESULT = (
    "Whisper returned no words. Your recording and transcript are unchanged."
)


def audio_chunks(audio_path, chunk_samples=CHUNK_SAMPLES):
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
            while len(pending) >= chunk_samples:
                yield pending[:chunk_samples].copy()
                pending = pending[chunk_samples:]
        if len(pending):
            yield np.pad(pending, (0, max(0, 400 - len(pending))))


def process(request, model_loader=None, predict=None):
    import torch

    whisper = request.get("backend", "whisper") == "whisper"
    if whisper:
        from backend.speech.whisper_backend import load_whisper as load_model, whisper_predict as predict_text
    else:
        from backend.speech.transcribe import load_checkpoint as load_model, transcribe_waveform as predict_text

    audio_path = Path(request["audioPath"])
    checkpoint = Path(request["checkpoint"]) if request.get("checkpoint") else None
    if not audio_path.is_file() or not 0 < audio_path.stat().st_size <= MAX_AUDIO:
        raise ValueError("Audio must be between 1 byte and 24 MB.")
    if not whisper and not (checkpoint and checkpoint.is_file()):
        raise ValueError("Our local speech checkpoint is missing. Train the model before transcribing.")
    torch.set_num_threads(4)
    model = (model_loader or load_model)(checkpoint)
    predictions = []
    size = 0
    chunk_samples = WHISPER_CHUNK_SAMPLES if whisper else CHUNK_SAMPLES
    for waveform in audio_chunks(audio_path, chunk_samples):
        prediction = (predict or predict_text)(waveform, model).strip()
        if prediction:
            size += len(prediction) + 1
            if size > 100000:
                raise ValueError("Transcription exceeds the 100,000-character limit.")
            predictions.append(prediction)
    transcript = " ".join(predictions)
    if not transcript:
        raise ValueError(WHISPER_EMPTY_RESULT if whisper else EMPTY_RESULT)
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
        print(json.dumps({"error": "Local transcription failed to decode the recording or load the speech model (the first Whisper run needs internet to download it). Your recording and transcript are unchanged."}))
        sys.exit(1)


if __name__ == "__main__":
    main()