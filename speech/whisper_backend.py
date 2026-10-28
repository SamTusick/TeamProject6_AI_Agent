import os

# English-only base model (~150 MB). Set WHISPER_MODEL=openai/whisper-base for multilingual.
DEFAULT_MODEL = "openai/whisper-base.en"


def load_whisper(_checkpoint=None):
    from transformers import pipeline

    return pipeline(
        "automatic-speech-recognition",
        model=os.getenv("WHISPER_MODEL", DEFAULT_MODEL),
    )


def whisper_predict(waveform, pipe):
    return pipe({"raw": waveform, "sampling_rate": 16000})["text"]
