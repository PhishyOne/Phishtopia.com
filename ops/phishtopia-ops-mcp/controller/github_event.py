from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .policy import ControllerError, parse_issue_comment_event


def _write_output(name: str, value: str) -> None:
    output = os.environ.get("GITHUB_OUTPUT")
    if output:
        with open(output, "a", encoding="utf-8") as handle:
            handle.write(f"{name}={value}\n")
    else:
        print(f"{name}={value}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("event", type=Path)
    parser.add_argument("--queue-issue", type=int, required=True)
    parser.add_argument("--request-file", type=Path, required=True)
    args = parser.parse_args()

    try:
        event = json.loads(args.event.read_text(encoding="utf-8"))
        prepared = parse_issue_comment_event(event, args.queue_issue)
        if prepared is None:
            _write_output("decision", "ignored")
            return
        encoded = json.dumps(prepared.envelope, separators=(",", ":"), sort_keys=True)
        args.request_file.write_text(encoded + "\n", encoding="utf-8")
        os.chmod(args.request_file, 0o600)
        _write_output("decision", "accepted")
        _write_output("request_id", prepared.request_id)
        _write_output("operation", prepared.operation)
    except (OSError, json.JSONDecodeError, ControllerError) as exc:
        _write_output("decision", "rejected")
        _write_output("error_code", str(exc) if isinstance(exc, ControllerError) else "invalid_event")


if __name__ == "__main__":
    main()
