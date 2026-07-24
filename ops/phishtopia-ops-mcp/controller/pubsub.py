from __future__ import annotations

import json
import os
import subprocess
import time
import uuid
from dataclasses import dataclass
from typing import Callable

from .policy import ControllerError, PROJECT_ID, REQUEST_TOPIC, RESPONSE_SUBSCRIPTION

Run = Callable[..., subprocess.CompletedProcess[str]]


@dataclass(frozen=True)
class PulledMessage:
    ack_id: str
    data: str
    request_id: str


class GcloudPubSub:
    def __init__(self, runner: Run = subprocess.run):
        self._runner = runner

    def _run(self, args: list[str], timeout: int = 30) -> str:
        command = ["gcloud", "pubsub", *args, "--project", PROJECT_ID, "--format=json"]
        try:
            result = self._runner(command, check=True, capture_output=True, text=True, timeout=timeout, env={**os.environ, "CLOUDSDK_CORE_DISABLE_PROMPTS": "1"})
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError) as exc:
            raise ControllerError("pubsub_unavailable") from exc
        if len(result.stdout.encode("utf-8")) > 65_536:
            raise ControllerError("pubsub_response_too_large")
        return result.stdout

    def publish(self, topic: str, data: str, request_id: str) -> None:
        if topic != REQUEST_TOPIC:
            raise ControllerError("invalid_topic")
        if not data or len(data) > 90_000 or any(c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=" for c in data):
            raise ControllerError("invalid_message")
        try:
            request_id = str(uuid.UUID(request_id))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ControllerError("invalid_request_id") from exc
        self._run(["topics", "publish", topic, f"--message={data}", f"--attribute=request_id={request_id}"])

    def pull(self, subscription: str) -> PulledMessage | None:
        if subscription != RESPONSE_SUBSCRIPTION:
            raise ControllerError("invalid_subscription")
        output = self._run(["subscriptions", "pull", subscription, "--limit=1"], timeout=35)
        try:
            value = json.loads(output or "[]")
        except json.JSONDecodeError as exc:
            raise ControllerError("invalid_pubsub_response") from exc
        if value == []:
            return None
        if not isinstance(value, list) or len(value) != 1 or not isinstance(value[0], dict):
            raise ControllerError("invalid_pubsub_response")
        item = value[0]
        message = item.get("message")
        if not isinstance(item.get("ackId"), str) or not isinstance(message, dict):
            raise ControllerError("invalid_pubsub_response")
        attributes = message.get("attributes")
        if not isinstance(message.get("data"), str) or not isinstance(attributes, dict):
            raise ControllerError("invalid_pubsub_response")
        try:
            request_id = str(uuid.UUID(attributes.get("request_id")))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ControllerError("invalid_pubsub_response") from exc
        return PulledMessage(item["ackId"], message["data"], request_id)

    def ack(self, subscription: str, ack_id: str) -> None:
        if subscription != RESPONSE_SUBSCRIPTION or not ack_id or len(ack_id) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in ack_id):
            raise ControllerError("invalid_ack")
        self._run(["subscriptions", "ack", subscription, f"--ack-ids={ack_id}"])


def wait_for_response(client: GcloudPubSub, subscription: str, request_id: str, timeout_seconds: int = 45, sleep: Callable[[float], None] = time.sleep) -> str:
    if not 1 <= timeout_seconds <= 120:
        raise ControllerError("invalid_timeout")
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        message = client.pull(subscription)
        if message is None:
            sleep(1)
            continue
        client.ack(subscription, message.ack_id)
        if message.request_id == request_id:
            return message.data
    raise ControllerError("response_timeout")
