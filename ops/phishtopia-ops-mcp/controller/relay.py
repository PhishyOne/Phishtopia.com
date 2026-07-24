from __future__ import annotations

import argparse
import json
import socket
import sys
from pathlib import Path
from typing import Any, Callable

from .policy import ControllerError, MAX_REQUEST_BYTES, MAX_RESPONSE_BYTES, decode_pubsub_message, encode_pubsub_message, stable_error_response, validate_request_envelope, validate_worker_response

SOCKET_PATH = Path("/run/phishtopia-ops-worker/worker.sock")


def connect_unix(path: Path, timeout: float = 5) -> socket.socket:
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(timeout)
    connection.connect(str(path))
    return connection


def exchange_worker(request: dict[str, Any], socket_path: Path = SOCKET_PATH, connector: Callable[[Path, float], socket.socket] = connect_unix) -> dict[str, Any]:
    encoded = json.dumps(request, separators=(",", ":"), sort_keys=True).encode() + b"\n"
    if len(encoded) > MAX_REQUEST_BYTES:
        raise ControllerError("request_too_large")
    response = bytearray()
    try:
        with connector(socket_path, 5) as connection:
            connection.sendall(encoded)
            connection.shutdown(socket.SHUT_WR)
            while True:
                chunk = connection.recv(4096)
                if not chunk:
                    break
                response.extend(chunk)
                if len(response) > MAX_RESPONSE_BYTES:
                    raise ControllerError("invalid_worker_response")
    except (OSError, TimeoutError) as exc:
        raise ControllerError("worker_unavailable") from exc
    try:
        return validate_worker_response(json.loads(response))
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ControllerError("invalid_worker_response") from exc


def process_message(encoded_message: str, queue_issue: int) -> dict[str, Any]:
    request_id = "00000000-0000-0000-0000-000000000000"
    try:
        envelope = decode_pubsub_message(encoded_message)
        if isinstance(envelope, dict) and isinstance(envelope.get("requestId"), str):
            request_id = envelope["requestId"]
        worker_request = validate_request_envelope(envelope, queue_issue)
        worker_response = exchange_worker(worker_request)
        return {"version": envelope["version"], "requestId": envelope["requestId"], "status": "ok", "response": worker_response}
    except ControllerError as exc:
        code = str(exc)
        mapped = code if code in {"worker_unavailable", "worker_rejected", "invalid_worker_response"} else "request_rejected"
        return stable_error_response(request_id, mapped)


def main() -> None:
    parser = argparse.ArgumentParser(description="Process one already-delivered Pub/Sub request")
    parser.add_argument("--queue-issue", type=int, required=True)
    args = parser.parse_args()
    encoded = sys.stdin.read(MAX_REQUEST_BYTES * 2)
    if not encoded or not encoded.endswith("\n"):
        raise SystemExit(2)
    print(encode_pubsub_message(process_message(encoded.strip(), args.queue_issue), MAX_RESPONSE_BYTES))


if __name__ == "__main__":
    main()
