from __future__ import annotations
import json
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from typing import Any, Callable
from .policy import ControllerError, PROJECT_ID, REQUEST_SUBSCRIPTION, RESPONSE_TOPIC
from .pubsub import PulledMessage
METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
PUBSUB_ROOT = f'https://pubsub.googleapis.com/v1/projects/{PROJECT_ID}'
MAX_HTTP_RESPONSE = 65536
Open = Callable[..., Any]

@dataclass
class AccessToken:
    value: str
    expires_at: float

class RestPubSub:
    """Fixed Pub/Sub REST client using the VM short-lived metadata token."""
    def __init__(self, opener: Open=urllib.request.urlopen, now: Callable[[], float]=time.time):
        self._open = opener
        self._now = now
        self._token: AccessToken | None = None

    def _read_json(self, request: urllib.request.Request, timeout: int, source: str) -> Any:
        try:
            with self._open(request, timeout=timeout) as response:
                raw = response.read(MAX_HTTP_RESPONSE + 1)
        except urllib.error.HTTPError as exc:
            if exc.code in (401, 403):
                code = f'{source}_permission_denied'
            elif exc.code == 404:
                code = f'{source}_not_found'
            elif exc.code == 429:
                code = f'{source}_rate_limited'
            elif 500 <= exc.code <= 599:
                code = f'{source}_service_unavailable'
            else:
                code = f'{source}_request_rejected'
            raise ControllerError(code) from exc
        except (OSError, urllib.error.URLError) as exc:
            raise ControllerError(f'{source}_unavailable') from exc
        if len(raw) > MAX_HTTP_RESPONSE:
            raise ControllerError(f'{source}_response_too_large')
        try:
            return json.loads(raw or b'{}')
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ControllerError(f'invalid_{source}_response') from exc

    def _access_token(self) -> str:
        if self._token and self._token.expires_at - self._now() >= 60:
            return self._token.value
        request = urllib.request.Request(METADATA_TOKEN_URL, headers={'Metadata-Flavor': 'Google'}, method='GET')
        value = self._read_json(request, 5, 'metadata')
        if not isinstance(value, dict) or not isinstance(value.get('access_token'), str) or type(value.get('expires_in')) is not int or not 60 <= value['expires_in'] <= 86400 or not 1 <= len(value['access_token']) <= 4096:
            raise ControllerError('invalid_metadata_token')
        self._token = AccessToken(value['access_token'], self._now() + value['expires_in'])
        return self._token.value

    def _post(self, path: str, payload: dict[str, Any], timeout: int=15) -> Any:
        if not path.startswith('/') or '..' in path or '?' in path or '#' in path:
            raise ControllerError('invalid_pubsub_path')
        encoded = json.dumps(payload, separators=(',', ':'), sort_keys=True).encode('utf-8')
        if len(encoded) > 65536:
            raise ControllerError('message_too_large')
        request = urllib.request.Request(PUBSUB_ROOT + path, data=encoded, headers={'Authorization': f'Bearer {self._access_token()}', 'Content-Type': 'application/json'}, method='POST')
        return self._read_json(request, timeout, 'pubsub')

    def _require_permission(self, path: str, permission: str) -> None:
        value = self._post(
            f'{path}:testIamPermissions',
            {'permissions': [permission]},
            timeout=5,
        )
        if value == {} or value == {'permissions': []}:
            raise ControllerError('pubsub_permission_denied')
        if value != {'permissions': [permission]}:
            raise ControllerError('invalid_pubsub_response')

    def verify_transport(self) -> None:
        """Verify the relay's exact consume and publish permissions without consuming."""
        self._require_permission(
            f'/subscriptions/{REQUEST_SUBSCRIPTION}',
            'pubsub.subscriptions.consume',
        )
        self._require_permission(
            f'/topics/{RESPONSE_TOPIC}',
            'pubsub.topics.publish',
        )

    def publish(self, topic: str, data: str, request_id: str) -> None:
        if topic != RESPONSE_TOPIC:
            raise ControllerError('invalid_topic')
        if not data or len(data) > 90000 or any(c not in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=' for c in data):
            raise ControllerError('invalid_message')
        try:
            request_id = str(uuid.UUID(request_id))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ControllerError('invalid_request_id') from exc
        value = self._post(f'/topics/{topic}:publish', {'messages': [{'data': data, 'attributes': {'request_id': request_id}}]})
        if not isinstance(value, dict) or not isinstance(value.get('messageIds'), list) or len(value['messageIds']) != 1:
            raise ControllerError('invalid_pubsub_response')

    def pull(self, subscription: str) -> PulledMessage | None:
        if subscription != REQUEST_SUBSCRIPTION:
            raise ControllerError('invalid_subscription')
        # Pub/Sub discourages returnImmediately for high-throughput consumers,
        # but this fixed low-volume control queue polls only once every five
        # idle seconds. That bounded behavior is preferable to treating an empty
        # unary long-pull deadline as a transport failure.
        value = self._post(
            f'/subscriptions/{subscription}:pull',
            {'maxMessages': 1, 'returnImmediately': True},
            timeout=10,
        )
        if value == {}:
            return None
        messages = value.get('receivedMessages') if isinstance(value, dict) else None
        if not isinstance(messages, list) or len(messages) != 1 or not isinstance(messages[0], dict):
            raise ControllerError('invalid_pubsub_response')
        item = messages[0]
        message = item.get('message')
        if not isinstance(item.get('ackId'), str) or not isinstance(message, dict) or not isinstance(message.get('data'), str) or not isinstance(message.get('attributes'), dict):
            raise ControllerError('invalid_pubsub_response')
        try:
            request_id = str(uuid.UUID(message['attributes'].get('request_id')))
        except (TypeError, ValueError, AttributeError) as exc:
            raise ControllerError('invalid_pubsub_response') from exc
        return PulledMessage(item['ackId'], message['data'], request_id)

    def ack(self, subscription: str, ack_id: str) -> None:
        if subscription != REQUEST_SUBSCRIPTION or not ack_id or len(ack_id) > 4096 or any(ord(c) < 32 or ord(c) == 127 for c in ack_id):
            raise ControllerError('invalid_ack')
        if self._post(f'/subscriptions/{subscription}:acknowledge', {'ackIds': [ack_id]}) != {}:
            raise ControllerError('invalid_pubsub_response')
