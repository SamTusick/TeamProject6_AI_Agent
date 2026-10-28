import re


VOCABULARY = ["<blank>", " ", "'", *"abcdefghijklmnopqrstuvwxyz"]
CHAR_TO_ID = {character: index for index, character in enumerate(VOCABULARY)}


def normalize_transcript(value: str) -> str:
    return " ".join(re.sub("[^a-z' ]", " ", value.lower()).split())


def encode(value: str) -> list[int]:
    normalized = normalize_transcript(value)
    if not normalized:
        raise ValueError("Transcript has no supported English characters.")
    return [CHAR_TO_ID[character] for character in normalized]


def decode_ctc(token_ids) -> str:
    characters = []
    previous = None
    for token in token_ids:
        token = int(token)
        if token != 0 and token != previous:
            characters.append(VOCABULARY[token])
        previous = token
    return "".join(characters).strip()