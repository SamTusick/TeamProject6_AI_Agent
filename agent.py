"""M2 prototype: turns a meeting transcript into approved, tracked action items.

Pipeline (see README for full explanation):
    [perceive]    read transcript file passed on the command line
    [reason]      ask the NRP model to classify candidate action items
    [guardrail]   verify each CONFIRMED item's quote appears in the transcript
    [confirm]     human approves/rejects each eligible item in the CLI
    [tool call]   approved items written via the MCP filesystem server
    [tool result] written file read back via the same server, printed
    [output]      summary of what was written, rejected, or flagged

Intentionally NOT implemented in this v1 (see README "Not implemented"):
live meeting join, Otter integration, Jira/Google Calendar writes,
memory across meetings, multi-agent design.
"""

import sys

# TODO (Step 3): import llm_client
# TODO (Step 2/6): import mcp_client
# TODO (Step 5): import verify


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python agent.py <path-to-transcript.txt> [--approve-all]")
        sys.exit(1)

    transcript_path = sys.argv[1]
    print(f"[perceive] reading transcript: {transcript_path}")
    # TODO: read file, call model, run guardrail, confirm loop, MCP write/read-back


if __name__ == "__main__":
    main()
