# Training Our Own Speech Model

This experimental pipeline learns from randomly initialized weights. It uses
PyTorch for tensor operations, a small convolutional/bidirectional GRU network,
log-power spectrograms, and character CTC loss. It does not download Whisper or
any other pretrained speech weights. It is not yet a usable meeting recognizer.

## Public Data and Attribution

Mini LibriSpeech: https://www.openslr.org/31/

Original LibriSpeech corpus: https://www.openslr.org/12/

License: Creative Commons Attribution 4.0 International,
https://creativecommons.org/licenses/by/4.0/

Credit: Vassil Panayotov, Guoguo Chen, Daniel Povey, and Sanjeev Khudanpur,
"LibriSpeech: An ASR corpus based on public domain audio books," ICASSP 2015.
Speech originates from LibriVox audiobooks. OpenSLR provides the Mini LibriSpeech
subset for regression testing. This project normalizes transcript casing and
punctuation and derives acoustic features; original audio is unchanged.
Retain this attribution and the license link when sharing derived dataset files.

The downloader checks publisher MD5 values obtained over HTTPS from
https://openslr.trmal.net/resources/31/md5sum.txt before extraction. These checks
detect corruption, not malicious changes by the publisher. Archive links and
path traversal are rejected.

- `train-clean-5`: 1,519 utterances, 5.31 hours.
- `dev-clean-2`: 1,089 utterances, 2.04 hours.
- Approximately 458 MB compressed per the source listing; reserve at least
  2 GB for archives, extracted files, and checkpoints.
- Speaker IDs are checked for disjoint training/development sets.
- Training currently filters to 0.1-15 second clips; reported metrics describe
  only the selected, filtered examples, not the complete corpus.
- Clean, read English speech does not represent overlapping voices, meeting
  microphones, accents, names, or speaker attribution adequately.
- Development metrics are for iteration, not a final independent test set.

## Setup and Short Validation

From the repository root with the existing Python 3.11 virtual environment:

```powershell
& .\.venv\Scripts\python.exe -m pip install -r requirements-speech.txt
& .\.venv\Scripts\python.exe -m unittest discover -s tests -p 'test_speech_*.py' -v
& .\.venv\Scripts\python.exe -m backend.speech.prepare
& .\.venv\Scripts\python.exe -m backend.speech.train --epochs 2 --max-train 32 --max-dev 16 --batch-size 4 --output .models/speech/my-smoke-run
```

Use a new output directory for every run. Existing checkpoints are not silently
overwritten by a new invocation. Each invocation starts from random weights;
checkpoint resumption is not implemented. Dataset downloads are reused after
checksum validation. Data, manifests, and weights stay under ignored `.models/`.
No speech API key is needed, and no microphone recordings are uploaded.

## First Executed Result

A CPU run used seed 42, 32 training examples, 16 development examples, batch size
4, and two epochs. All six focused unit tests passed, including finite gradients,
weight changes, checkpoint round-trip, batch padding, and CTC decoding.

| Measurement                      | Before training | After two epochs |
| -------------------------------- | --------------: | ---------------: |
| Development CTC loss             |          9.7846 |           3.0981 |
| Development word error rate      |            100% |             100% |
| Development character error rate |          90.88% |             100% |

The trained model currently predicts empty transcripts. A lower CTC loss alone
is not evidence of useful recognition. The saved checkpoint is a pipeline
artifact, not a production model.

Local artifacts from this run:

- `.models/speech/smoke-run/checkpoint.pt`
- `.models/speech/smoke-run/metrics.json`, including config, library version,
  selected utterance IDs, before/after metrics, and sample predictions.

## Larger Training Experiment

This command starts a fresh, longer run on the filtered public training set:

```powershell
& .\.venv\Scripts\python.exe -m backend.speech.train --epochs 20 --batch-size 4 --output .models/speech/full-run
```

It has not been run as part of the short validation. It may be slow on this
Windows ARM laptop running x86-64 Python. Its Qualcomm GPU is not CUDA-capable.
On an NVIDIA training machine with a CUDA-enabled PyTorch installation, add
`--device cuda`. No cloud resources are provisioned by these scripts.

Twenty epochs on this small dataset do not guarantee usable recognition. Assess
WER and CER plus actual predictions, then expand licensed training data, tune the
network and training schedule, and build a separately held-out meeting test set.
WER can exceed 100% when there are many inserted words. There is no language-model
decoder, punctuation restoration, diarization, streaming, or noise augmentation.

## Experimental Checkpoint Inference

```powershell
& .\.venv\Scripts\python.exe -m backend.speech.transcribe path/to/clip.wav --checkpoint .models/speech/smoke-run/checkpoint.pt
```

This CLI accepts mono 16 kHz WAV/FLAC clips between 25 ms and 15 seconds.
Only load trusted project checkpoints. Empty output is currently expected for
the short-run checkpoint.

The desktop's **Transcribe locally (experimental)** button now uses
`.models/speech/smoke-run/checkpoint.pt` through `backend.workers.transcription_worker`.
Install `requirements-speech.txt`, then restart Electron after code changes.
No speech API key, Whisper, pretrained speech weights, or audio upload is used.
PyAV decodes WebM/Opus, downmixes to mono, and resamples to 16 kHz. Inference uses
non-overlapping 15-second chunks with a 30-minute/24 MB input limit and a
10-minute worker timeout. Chunk boundaries can split words; this is experimental,
not streaming or production-quality transcription.

An empty result shows an explicit model-training warning and preserves the
recording, transcript, and decisions. A nonempty result replaces the transcript
and invalidates prior decisions. Ten Python speech tests and the Electron flow
with synthetic audio and the actual checkpoint passed. This verifies integration,
not recognition accuracy. Longer recordings have not been performance-tested.
NRP action analysis remains a separate service with its existing credentials.
