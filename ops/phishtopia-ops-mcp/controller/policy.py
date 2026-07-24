from __future__ import annotations
import base64
import json
import re
import uuid
from dataclasses import dataclass
from typing import Any
from worker.allowlist import ACTION_NAMES, ValidationError, validate_action, validate_job_id
REPOSITORY = 'PhishyOne/Phishtopia.com'
OWNER = 'PhishyOne'
OWNER_ID = 123998606
REPOSITORY_ID = 997939289
PROJECT_ID = 'project-43a8be4b-69a7-4d52-805'
REQUEST_TOPIC = 'phishtopia-ops-requests'
REQUEST_SUBSCRIPTION = 'phishtopia-ops-vm-requests'
RESPONSE_TOPIC = 'phishtopia-ops-responses'
RESPONSE_SUBSCRIPTION = 'phishtopia-ops-github-responses'
PROTOCOL_VERSION = 'issue15-external-v1'
COMMAND_PREFIX = '/phishtopia-ops'
MAX_COMMENT_BYTES = 8192
MAX_REQUEST_BYTES = 32768
MAX_RESPONSE_BYTES = 65536
MAX_OBSERVATIONS = 12
MAX_OBSERVATION_VALUE = 160
_ALLOWED_OPERATIONS = frozenset(('start_job', 'get_job_status', 'cancel_job'))
_JOB_STATES = frozenset(('queued', 'running', 'succeeded', 'failed', 'cancelling', 'cancelled'))
_RESULT_CODES = frozenset(('accepted', 'in_progress', 'completed', 'cancel_requested', 'cancelled_and_rolled_back', 'failed_and_rolled_back', 'rollback_failed', 'preflight_rejected', 'failed_without_mutation', 'not_found'))
_OBSERVATION_NAME = re.compile('^[a-z][a-z0-9_]{0,63}$')

class ControllerError(ValueError):
    """Stable, non-sensitive controller rejection."""

@dataclass(frozen=True)
class PreparedCommand:
    request_id: str
    operation: str
    envelope: dict[str, Any]

def _exact_dict(value: Any, keys: set[str], code: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise ControllerError(code)
    return value

def _bounded_json(value: Any, maximum: int, code: str) -> bytes:
    try:
        encoded = json.dumps(value, separators=(',', ':'), sort_keys=True).encode('utf-8')
    except (TypeError, ValueError) as exc:
        raise ControllerError(code) from exc
    if len(encoded) > maximum:
        raise ControllerError(code)
    return encoded

def _request_id(issue_number: int, comment_id: int) -> str:
    material = f'https://github.com/{REPOSITORY}/issues/{issue_number}#issuecomment-{comment_id}'
    return str(uuid.uuid5(uuid.NAMESPACE_URL, material))

def parse_issue_comment_event(event: Any, queue_issue: int) -> PreparedCommand | None:
    if not isinstance(queue_issue, int) or queue_issue <= 0:
        raise ControllerError('invalid_queue_issue')
    if not isinstance(event, dict):
        raise ControllerError('invalid_event')
    repository = event.get('repository')
    issue = event.get('issue')
    comment = event.get('comment')
    if not isinstance(repository, dict) or repository.get('full_name') != REPOSITORY:
        return None
    if repository.get('id') != REPOSITORY_ID:
        raise ControllerError('repository_not_allowed')
    if not isinstance(issue, dict) or issue.get('number') != queue_issue:
        return None
    if event.get('action') != 'created':
        raise ControllerError('invalid_event_action')
    if issue.get('locked') is not True:
        raise ControllerError('queue_not_locked')
    if issue.get('pull_request') is not None:
        raise ControllerError('queue_must_be_issue')
    if not isinstance(comment, dict):
        raise ControllerError('invalid_comment')
    actor = comment.get('user')
    if isinstance(actor, dict) and actor.get('type') == 'Bot':
        return None
    if not isinstance(actor, dict) or actor.get('login') != OWNER or actor.get('id') != OWNER_ID:
        raise ControllerError('actor_not_allowed')
    if comment.get('author_association') != 'OWNER':
        raise ControllerError('actor_not_owner')
    comment_id = comment.get('id')
    body = comment.get('body')
    if type(comment_id) is not int or comment_id <= 0:
        raise ControllerError('invalid_comment_id')
    if not isinstance(body, str) or not body:
        raise ControllerError('invalid_command')
    if len(body.encode('utf-8')) > MAX_COMMENT_BYTES:
        raise ControllerError('command_too_large')
    if '\x00' in body or '\r' in body:
        raise ControllerError('invalid_command')
    lines = body.split('\n', 1)
    if len(lines) != 2 or lines[0] != COMMAND_PREFIX:
        raise ControllerError('invalid_command_prefix')
    try:
        command = json.loads(lines[1])
    except json.JSONDecodeError as exc:
        raise ControllerError('invalid_command_json') from exc
    command = _exact_dict(command, {'operation', 'payload'}, 'invalid_command_fields')
    operation = command['operation']
    payload = command['payload']
    if operation not in _ALLOWED_OPERATIONS:
        raise ControllerError('invalid_operation')
    if operation == 'start_job':
        payload = _exact_dict(payload, {'action'}, 'invalid_start_payload')
        try:
            action = validate_action(payload['action'])
        except ValidationError as exc:
            raise ControllerError('invalid_action') from exc
        worker_payload: dict[str, Any] = {'idempotencyKey': f'github:{queue_issue}:{comment_id}', 'action': action}
    else:
        payload = _exact_dict(payload, {'jobId'}, 'invalid_job_payload')
        try:
            job_id = validate_job_id(payload['jobId'])
        except ValidationError as exc:
            raise ControllerError('invalid_job_id') from exc
        worker_payload = {'jobId': job_id}
    request_id = _request_id(queue_issue, comment_id)
    envelope = {'version': PROTOCOL_VERSION, 'requestId': request_id, 'source': {'repository': REPOSITORY, 'repositoryId': REPOSITORY_ID, 'issue': queue_issue, 'comment': comment_id, 'actor': OWNER, 'actorId': OWNER_ID}, 'operation': operation, 'payload': worker_payload}
    _bounded_json(envelope, MAX_REQUEST_BYTES, 'request_too_large')
    return PreparedCommand(request_id=request_id, operation=operation, envelope=envelope)

def validate_request_envelope(value: Any, queue_issue: int) -> dict[str, Any]:
    envelope = _exact_dict(value, {'version', 'requestId', 'source', 'operation', 'payload'}, 'invalid_envelope')
    if envelope['version'] != PROTOCOL_VERSION:
        raise ControllerError('invalid_version')
    try:
        request_id = str(uuid.UUID(envelope['requestId']))
    except (TypeError, ValueError, AttributeError) as exc:
        raise ControllerError('invalid_request_id') from exc
    source = _exact_dict(envelope['source'], {'repository', 'repositoryId', 'issue', 'comment', 'actor', 'actorId'}, 'invalid_source')
    if source != {'repository': REPOSITORY, 'repositoryId': REPOSITORY_ID, 'issue': queue_issue, 'comment': source.get('comment'), 'actor': OWNER, 'actorId': OWNER_ID}:
        raise ControllerError('invalid_source')
    if type(source['comment']) is not int or source['comment'] <= 0:
        raise ControllerError('invalid_source')
    expected = _request_id(queue_issue, source['comment'])
    if request_id != expected:
        raise ControllerError('request_id_mismatch')
    operation = envelope['operation']
    payload = envelope['payload']
    if operation == 'start_job':
        payload = _exact_dict(payload, {'idempotencyKey', 'action'}, 'invalid_start_payload')
        expected_key = f"github:{queue_issue}:{source['comment']}"
        if payload['idempotencyKey'] != expected_key:
            raise ControllerError('idempotency_mismatch')
        try:
            action = validate_action(payload['action'])
        except ValidationError as exc:
            raise ControllerError('invalid_action') from exc
        worker = {'operation': operation, 'payload': {'idempotencyKey': expected_key, 'action': action}}
    elif operation in {'get_job_status', 'cancel_job'}:
        payload = _exact_dict(payload, {'jobId'}, 'invalid_job_payload')
        try:
            job_id = validate_job_id(payload['jobId'])
        except ValidationError as exc:
            raise ControllerError('invalid_job_id') from exc
        worker = {'operation': operation, 'payload': {'jobId': job_id}}
    else:
        raise ControllerError('invalid_operation')
    _bounded_json(worker, MAX_REQUEST_BYTES, 'request_too_large')
    return worker

def encode_pubsub_message(value: Any, maximum: int=MAX_REQUEST_BYTES) -> str:
    return base64.b64encode(_bounded_json(value, maximum, 'message_too_large')).decode('ascii')

def decode_pubsub_message(value: Any, maximum: int=MAX_REQUEST_BYTES) -> Any:
    if not isinstance(value, str) or len(value) > (maximum + 2) // 3 * 4 + 4:
        raise ControllerError('invalid_message')
    try:
        raw = base64.b64decode(value, validate=True)
    except (ValueError, TypeError) as exc:
        raise ControllerError('invalid_message') from exc
    if len(raw) > maximum:
        raise ControllerError('message_too_large')
    try:
        return json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ControllerError('invalid_message') from exc

def validate_worker_response(value: Any) -> dict[str, Any]:
    response = _exact_dict(value, {'ok', 'job'}, 'invalid_worker_response')
    if response['ok'] is not True:
        raise ControllerError('worker_rejected')
    job_fields = {'jobId', 'action', 'state', 'progress', 'createdAt', 'updatedAt', 'deadlineAt', 'observations'}
    if isinstance(response.get('job'), dict) and 'resultCode' in response['job']:
        job_fields.add('resultCode')
    job = _exact_dict(response['job'], job_fields, 'invalid_job_response')
    try:
        job_id = str(uuid.UUID(job['jobId']))
    except (TypeError, ValueError, AttributeError) as exc:
        raise ControllerError('invalid_job_response') from exc
    if job['action'] not in ACTION_NAMES or job['state'] not in _JOB_STATES:
        raise ControllerError('invalid_job_response')
    if type(job['progress']) is not int or not 0 <= job['progress'] <= 100:
        raise ControllerError('invalid_job_response')
    for key in ('createdAt', 'updatedAt', 'deadlineAt'):
        if not isinstance(job[key], str) or len(job[key]) > 40 or 'T' not in job[key]:
            raise ControllerError('invalid_job_response')
    result_code = job.get('resultCode')
    if result_code is not None and result_code not in _RESULT_CODES:
        raise ControllerError('invalid_job_response')
    observations = job['observations']
    if not isinstance(observations, list) or len(observations) > MAX_OBSERVATIONS:
        raise ControllerError('invalid_job_response')
    clean_observations: list[dict[str, str]] = []
    for item in observations:
        item = _exact_dict(item, {'name', 'value'}, 'invalid_job_response')
        if not isinstance(item['name'], str) or not _OBSERVATION_NAME.fullmatch(item['name']):
            raise ControllerError('invalid_job_response')
        if not isinstance(item['value'], str) or len(item['value']) > MAX_OBSERVATION_VALUE:
            raise ControllerError('invalid_job_response')
        clean_observations.append(dict(item))
    clean = {'jobId': job_id, 'action': job['action'], 'state': job['state'], 'progress': job['progress'], 'createdAt': job['createdAt'], 'updatedAt': job['updatedAt'], 'deadlineAt': job['deadlineAt'], 'observations': clean_observations}
    if result_code is not None:
        clean['resultCode'] = result_code
    result = {'ok': True, 'job': clean}
    _bounded_json(result, MAX_RESPONSE_BYTES, 'response_too_large')
    return result

def stable_error_response(request_id: str, code: str) -> dict[str, str]:
    try:
        request_id = str(uuid.UUID(request_id))
    except (TypeError, ValueError, AttributeError):
        request_id = '00000000-0000-0000-0000-000000000000'
    allowed = {'request_rejected', 'worker_unavailable', 'worker_rejected', 'invalid_worker_response', 'response_timeout'}
    return {'version': PROTOCOL_VERSION, 'requestId': request_id, 'status': 'error', 'code': code if code in allowed else 'request_rejected'}

def validate_controller_response(value: Any, request_id: str) -> dict[str, Any]:
    try:
        expected = str(uuid.UUID(request_id))
    except (TypeError, ValueError, AttributeError) as exc:
        raise ControllerError('invalid_request_id') from exc
    if not isinstance(value, dict):
        raise ControllerError('invalid_controller_response')
    status = value.get('status')
    if status == 'ok':
        response = _exact_dict(value, {'version', 'requestId', 'status', 'response'}, 'invalid_controller_response')
        if response['version'] != PROTOCOL_VERSION or response['requestId'] != expected:
            raise ControllerError('response_mismatch')
        return {'version': PROTOCOL_VERSION, 'requestId': expected, 'status': 'ok', 'response': validate_worker_response(response['response'])}
    if status == 'error':
        response = _exact_dict(value, {'version', 'requestId', 'status', 'code'}, 'invalid_controller_response')
        if response['version'] != PROTOCOL_VERSION or response['requestId'] != expected:
            raise ControllerError('response_mismatch')
        if response['code'] not in {'request_rejected', 'worker_unavailable', 'worker_rejected', 'invalid_worker_response', 'response_timeout'}:
            raise ControllerError('invalid_controller_response')
        return dict(response)
    raise ControllerError('invalid_controller_response')
