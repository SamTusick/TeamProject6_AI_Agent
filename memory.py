"""Knowledge/memory layer: persistent cross-meeting memory with lexical retrieval.

Every human-approved action item is stored (with its owner, deadline, source
quote and meeting) in a JSON file that survives between runs. Agents query it
two ways:

    search(query)      ranked retrieval over past items (RAG-lite: TF-IDF-style
                       keyword scoring, no embeddings, no external service)
    find_duplicate()   detects an item the team already committed to before

Honest limits: retrieval is lexical, so paraphrases with no shared words are
missed, and memory is only as good as what a human approved. Memory is a hint
for agents - it is never accepted as evidence for an owner or deadline; that
must still come from a quote in the current transcript.
"""

import json
import math
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_MEMORY_FILE = Path(__file__).parent / "output" / "memory.json"

_STOPWORDS = frozenset(
    "a an and are as at be by for from has have i in is it of on or our that the "
    "this to we will with you your should can need needs".split()
)


def tokenize(text: str) -> list[str]:
    words = re.findall(r"[a-z0-9']+", (text or "").lower())
    return [w for w in words if w not in _STOPWORDS and len(w) > 1]


class MeetingMemory:
    def __init__(self, path: str | os.PathLike | None = None):
        self.path = Path(path or os.getenv("MEMORY_FILE") or DEFAULT_MEMORY_FILE)
        self.records: list[dict] = []
        self._load()

    def _load(self) -> None:
        if not self.path.is_file():
            return
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            print(f"[memory] WARNING: could not read {self.path} ({exc}); starting empty")
            return
        if isinstance(data, list):
            self.records = [r for r in data if isinstance(r, dict)]

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self.path.parent, suffix=".tmp")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(self.records, f, indent=2)
        os.replace(tmp, self.path)

    @staticmethod
    def _text(record: dict) -> str:
        return " ".join(
            str(record.get(k) or "") for k in ("title", "owner", "deadline", "quote")
        )

    def remember(self, items: list[dict], meeting: str) -> int:
        """Store approved items. Skips ones identical to an existing record."""
        added = 0
        stamp = datetime.now(timezone.utc).isoformat(timespec="seconds")
        for item in items:
            record = {
                "title": item.get("title"),
                "owner": item.get("owner"),
                "deadline": item.get("deadline"),
                "quote": item.get("quote"),
                "meeting": meeting,
                "saved_at": stamp,
            }
            if any(self._same(r, record) for r in self.records):
                continue
            self.records.append(record)
            added += 1
        if added:
            self._save()
        return added

    @staticmethod
    def _same(a: dict, b: dict) -> bool:
        return (
            (a.get("title") or "").strip().lower() == (b.get("title") or "").strip().lower()
            and (a.get("owner") or "").strip().lower() == (b.get("owner") or "").strip().lower()
        )

    def search(self, query: str, k: int = 3) -> list[dict]:
        """Rank stored records by TF-IDF overlap with the query."""
        terms = set(tokenize(query))
        if not terms or not self.records:
            return []
        docs = [set(tokenize(self._text(r))) for r in self.records]
        n = len(docs)
        scored = []
        for record, doc in zip(self.records, docs):
            score = 0.0
            for term in terms & doc:
                df = sum(1 for d in docs if term in d)
                score += math.log(1 + n / df)
            if score > 0:
                scored.append((score, record))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [record for _, record in scored[:k]]

    def find_duplicate(self, item: dict, threshold: float = 0.6) -> dict | None:
        """Return a prior record that looks like the same commitment, if any.

        Same title words (Jaccard >= threshold) and, when both sides name an
        owner, the same owner.
        """
        mine = set(tokenize(item.get("title", "")))
        if not mine:
            return None
        for record in self.records:
            theirs = set(tokenize(record.get("title", "")))
            if not theirs:
                continue
            overlap = len(mine & theirs) / len(mine | theirs)
            owner_a = (item.get("owner") or "").strip().lower()
            owner_b = (record.get("owner") or "").strip().lower()
            if overlap >= threshold and (not owner_a or not owner_b or owner_a == owner_b):
                return record
        return None

    def format_hits(self, hits: list[dict]) -> str:
        if not hits:
            return "no matching memory records"
        return "\n".join(
            f"- '{h.get('title')}' owner={h.get('owner')} deadline={h.get('deadline')} "
            f"(meeting {h.get('meeting')})"
            for h in hits
        )
