"""Command-line entry point.

    python -m backend.main <path-to-transcript.txt> [--approve-all]
"""

import asyncio
import sys

from backend.pipeline import run


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python -m backend.main <path-to-transcript.txt> [--approve-all]")
        sys.exit(1)

    transcript_path = sys.argv[1]
    approve_all = "--approve-all" in sys.argv[2:]

    asyncio.run(run(transcript_path, approve_all))


if __name__ == "__main__":
    main()
