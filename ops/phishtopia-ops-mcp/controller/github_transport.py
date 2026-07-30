from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from .policy import (
    ControllerError,
    REQUEST_TOPIC,
    RESPONSE_SUBSCRIPTION,
    decode_pubsub_message,
    validate_controller_response,
)
from .pubsub import GcloudPubSub, wait_for_response


def render_markdown(value: dict[str, object]) -> str:
    request_id = value["requestId"]
    if value["status"] == "error":
        return (
            "### Phishtopia Ops\n\n"
            f"Request `{request_id}` was rejected with `{value['code']}`. "
            "No raw logs, commands, credentials, or secret values were returned.\n"
        )
    job = value["response"]["job"]  # type: ignore[index]
    lines = [
        "### Phishtopia Ops",
        "",
        f"Request: `{request_id}`",
        f"Job: `{job['jobId']}`",
        f"Action: `{job['action']}`",
        f"State: `{job['state']}`",
        f"Progress: `{job['progress']}%`",
    ]
    if job.get("resultCode"):
        lines.append(f"Result: `{job['resultCode']}`")
    observations = job.get("observations", [])
    if observations:
        lines.extend(("", "Sanitized observations:"))
        for item in observations:
            lines.append(f"- `{item['name']}`: {item['value']}")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--request-file", type=Path, required=True)
    parser.add_argument("--response-file", type=Path, required=True)
    parser.add_argument("--comment-file", type=Path, required=True)
    args = parser.parse_args()

    request = json.loads(args.request_file.read_text(encoding="utf-8"))
    request_id = request["requestId"]
    client = GcloudPubSub()
    client.publish(REQUEST_TOPIC, request, request_id)
    encoded = wait_for_response(client, RESPONSE_SUBSCRIPTION, request_id)
    response = validate_controller_response(decode_pubsub_message(encoded, 65_536), request_id)
    args.response_file.write_text(
        json.dumps(response, separators=(",", ":"), sort_keys=True) + "\n",
        encoding="utf-8",
    )
    args.comment_file.write_text(render_markdown(response), encoding="utf-8")
    os.chmod(args.response_file, 0o600)
    os.chmod(args.comment_file, 0o600)


if __name__ == "__main__":
    try:
        main()
    except (ControllerError, OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise SystemExit(str(exc)) from None
