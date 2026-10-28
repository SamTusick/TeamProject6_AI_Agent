import argparse
import hashlib
import json
from pathlib import Path
import shutil
import tarfile
import urllib.request

import soundfile

from speech.text import normalize_transcript


DATASETS = {
    "train-clean-5": "5df7d4e78065366204ca6845bb08f490",
    "dev-clean-2": "6d7ab67ac6a1d2c993d050e16d61080d",
}
SOURCE = "https://openslr.trmal.net/resources/31"


def checksum(path):
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download(split, destination):
    archive = destination / f"{split}.tar.gz"
    expected = DATASETS[split]
    if archive.exists() and checksum(archive) == expected:
        return archive
    partial = archive.with_suffix(".part")
    print(f"Downloading {split} from OpenSLR (CC BY 4.0)...", flush=True)
    try:
        with urllib.request.urlopen(f"{SOURCE}/{archive.name}", timeout=60) as response:
            with partial.open("wb") as stream:
                total = 0
                while chunk := response.read(1024 * 1024):
                    stream.write(chunk)
                    total += len(chunk)
                    if total % (32 * 1024 * 1024) == 0:
                        print(f"  {total // (1024 * 1024)} MiB", flush=True)
        if checksum(partial) != expected:
            raise ValueError(f"Checksum mismatch for {split}; download discarded.")
        partial.replace(archive)
    finally:
        partial.unlink(missing_ok=True)
    return archive


def extract(archive, destination):
    destination = destination.resolve()
    with tarfile.open(archive, "r:gz") as bundle:
        for member in bundle:
            target = (destination / member.name).resolve()
            if not target.is_relative_to(destination):
                raise ValueError("Unsafe archive path.")
            if member.isdir():
                continue
            if not member.isfile():
                raise ValueError("Archive links and special files are not allowed.")
            if target.suffix not in {".flac", ".txt"}:
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.extractfile(member) as source, target.open("wb") as output:
                shutil.copyfileobj(source, output)


def manifest(destination, split):
    records = []
    for transcript in sorted((destination / "LibriSpeech" / split).rglob("*.trans.txt")):
        for line in transcript.read_text(encoding="utf-8").splitlines():
            utterance, text = line.split(" ", 1)
            audio = transcript.parent / f"{utterance}.flac"
            info = soundfile.info(audio)
            if info.samplerate != 16000 or info.channels != 1:
                raise ValueError(f"Expected mono 16 kHz audio: {audio.name}")
            records.append({
                "id": utterance,
                "speaker": utterance.split("-")[0],
                "audio": audio.relative_to(destination).as_posix(),
                "text": normalize_transcript(text),
                "seconds": info.frames / info.samplerate,
            })
    if not records:
        raise ValueError(f"No transcripts found for {split}.")
    (destination / f"{split}.json").write_text(json.dumps(records, indent=2), encoding="utf-8")
    return records


def main():
    parser = argparse.ArgumentParser(description="Download verified Mini LibriSpeech public audio.")
    parser.add_argument("--data", type=Path, default=Path(".models/speech/data"))
    args = parser.parse_args()
    args.data.mkdir(parents=True, exist_ok=True)
    speakers = []
    for split in DATASETS:
        archive = download(split, args.data)
        extract(archive, args.data)
        records = manifest(args.data, split)
        speakers.append({record["speaker"] for record in records})
        print(f"{split}: {len(records)} utterances, {sum(record['seconds'] for record in records) / 3600:.2f} hours", flush=True)
    if speakers[0] & speakers[1]:
        raise ValueError("Training and development speakers overlap.")
    print("Prepared speaker-disjoint training and development manifests.", flush=True)


if __name__ == "__main__":
    main()