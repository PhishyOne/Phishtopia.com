from __future__ import annotations
import json
import unittest
import urllib.error
import uuid
from unittest.mock import patch
from controller.policy import COMMAND_PREFIX, ControllerError, REQUEST_SUBSCRIPTION, decode_pubsub_message, encode_pubsub_message, parse_issue_comment_event, validate_request_envelope, validate_worker_response
from controller.pubsub import PulledMessage
from controller.pubsub_rest import RestPubSub

QUEUE = 41
JOB_ID = '123e4567-e89b-42d3-a456-426614174000'

def event(command=None):
    command = command or {'operation': 'start_job', 'payload': {'action': {'type': 'restart_phishtopia_service', 'service': 'phishtopia_app'}}}
    return {'action': 'created', 'repository': {'full_name': 'PhishyOne/Phishtopia.com', 'id': 997939289}, 'issue': {'number': QUEUE, 'locked': True}, 'comment': {'id': 987654321, 'body': COMMAND_PREFIX + '\n' + json.dumps(command), 'author_association': 'OWNER', 'user': {'login': 'PhishyOne', 'id': 123998606, 'type': 'User'}}}

def job_response():
    return {'ok': True, 'job': {'jobId': JOB_ID, 'action': 'restart_phishtopia_service', 'state': 'queued', 'progress': 0, 'createdAt': '2026-07-24T12:00:00Z', 'updatedAt': '2026-07-24T12:00:00Z', 'deadlineAt': '2026-07-24T12:03:00Z', 'resultCode': 'accepted', 'observations': []}}

class Response:
    def __init__(self, value):
        self.body = json.dumps(value, separators=(',', ':')).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, _maximum):
        return self.body

class PolicyTests(unittest.TestCase):
    def test_owner_command_is_canonical(self):
        prepared = parse_issue_comment_event(event(), QUEUE)
        self.assertEqual(prepared.envelope['payload']['idempotencyKey'], 'github:41:987654321')
        self.assertEqual(validate_request_envelope(prepared.envelope, QUEUE)['operation'], 'start_job')

    def test_other_issue_is_ignored(self):
        value = event(); value['issue']['number'] += 1
        self.assertIsNone(parse_issue_comment_event(value, QUEUE))

    def test_bot_response_is_ignored(self):
        value = event(); value['comment']['user'] = {'type': 'Bot'}
        self.assertIsNone(parse_issue_comment_event(value, QUEUE))

    def test_repository_id_is_immutable(self):
        value = event(); value['repository']['id'] = 1
        with self.assertRaisesRegex(ControllerError, 'repository_not_allowed'):
            parse_issue_comment_event(value, QUEUE)

    def test_owner_id_is_immutable(self):
        value = event(); value['comment']['user']['id'] = 1
        with self.assertRaisesRegex(ControllerError, 'actor_not_allowed'):
            parse_issue_comment_event(value, QUEUE)

    def test_queue_must_be_locked(self):
        value = event(); value['issue']['locked'] = False
        with self.assertRaisesRegex(ControllerError, 'queue_not_locked'):
            parse_issue_comment_event(value, QUEUE)

    def test_user_cannot_supply_idempotency(self):
        command = {'operation': 'start_job', 'payload': {'idempotencyKey': 'attacker', 'action': {'type': 'restart_phishtopia_service', 'service': 'phishtopia_app'}}}
        with self.assertRaisesRegex(ControllerError, 'invalid_start_payload'):
            parse_issue_comment_event(event(command), QUEUE)

    def test_unknown_action_is_rejected(self):
        command = {'operation': 'start_job', 'payload': {'action': {'type': 'shell', 'command': 'id'}}}
        with self.assertRaisesRegex(ControllerError, 'invalid_action'):
            parse_issue_comment_event(event(command), QUEUE)

    def test_status_requires_uuid(self):
        command = {'operation': 'get_job_status', 'payload': {'jobId': 'nope'}}
        with self.assertRaisesRegex(ControllerError, 'invalid_job_id'):
            parse_issue_comment_event(event(command), QUEUE)

    def test_envelope_tampering_is_rejected(self):
        prepared = parse_issue_comment_event(event(), QUEUE)
        prepared.envelope['source']['actorId'] = 1
        with self.assertRaisesRegex(ControllerError, 'invalid_source'):
            validate_request_envelope(prepared.envelope, QUEUE)

    def test_pubsub_encoding_round_trips(self):
        prepared = parse_issue_comment_event(event(), QUEUE)
        self.assertEqual(decode_pubsub_message(encode_pubsub_message(prepared.envelope)), prepared.envelope)

    def test_worker_response_drops_no_extra_fields(self):
        value = job_response(); value['job']['rawLog'] = 'secret'
        with self.assertRaisesRegex(ControllerError, 'invalid_job_response'):
            validate_worker_response(value)

class RelayTests(unittest.TestCase):
    def test_publish_happens_before_ack(self):
        from controller.relay_daemon import run_once
        prepared = parse_issue_comment_event(event(), QUEUE)
        encoded = encode_pubsub_message(prepared.envelope)
        calls = []
        class Client:
            def pull(self, _): return PulledMessage('ack', encoded, prepared.request_id)
            def publish(self, *_): calls.append('publish')
            def ack(self, *_): calls.append('ack')
        with patch('controller.relay.exchange_worker', return_value=job_response()):
            self.assertTrue(run_once(Client(), QUEUE))
        self.assertEqual(calls, ['publish', 'ack'])

    def test_publish_failure_does_not_ack(self):
        from controller.relay_daemon import run_once
        prepared = parse_issue_comment_event(event(), QUEUE)
        encoded = encode_pubsub_message(prepared.envelope)
        calls = []
        class Client:
            def pull(self, _): return PulledMessage('ack', encoded, prepared.request_id)
            def publish(self, *_): raise ControllerError('pubsub_unavailable')
            def ack(self, *_): calls.append('ack')
        with patch('controller.relay.exchange_worker', return_value=job_response()):
            with self.assertRaisesRegex(ControllerError, 'pubsub_unavailable'):
                run_once(Client(), QUEUE)
        self.assertEqual(calls, [])

class RestPubSubTests(unittest.TestCase):
    def test_readiness_checks_exact_permissions_before_bounded_empty_pull(self):
        calls = []
        responses = iter((
            {'access_token': 'token', 'expires_in': 3600},
            {'permissions': ['pubsub.subscriptions.consume']},
            {'permissions': ['pubsub.topics.publish']},
            {},
        ))

        def opener(request, timeout):
            payload = json.loads(request.data) if request.data else None
            calls.append((request.full_url, payload, timeout))
            return Response(next(responses))

        client = RestPubSub(opener=opener, now=lambda: 0)
        client.verify_transport()
        self.assertIsNone(client.pull(REQUEST_SUBSCRIPTION))

        self.assertEqual(calls[1][1], {'permissions': ['pubsub.subscriptions.consume']})
        self.assertTrue(calls[1][0].endswith(
            '/subscriptions/phishtopia-ops-vm-requests:testIamPermissions'
        ))
        self.assertEqual(calls[2][1], {'permissions': ['pubsub.topics.publish']})
        self.assertTrue(calls[2][0].endswith(
            '/topics/phishtopia-ops-responses:testIamPermissions'
        ))
        self.assertEqual(
            calls[3][1],
            {'maxMessages': 1, 'returnImmediately': True},
        )
        self.assertLessEqual(calls[3][2], 10)

    def test_readiness_rejects_missing_runtime_permission(self):
        responses = iter((
            {'access_token': 'token', 'expires_in': 3600},
            {},
        ))

        def opener(_request, timeout):
            self.assertGreater(timeout, 0)
            return Response(next(responses))

        client = RestPubSub(opener=opener, now=lambda: 0)
        with self.assertRaisesRegex(ControllerError, '^pubsub_permission_denied$'):
            client.verify_transport()

    def test_pubsub_http_denial_has_fixed_non_sensitive_code(self):
        responses = iter(({'access_token': 'token', 'expires_in': 3600},))

        def opener(request, timeout):
            self.assertGreater(timeout, 0)
            if request.full_url.startswith('http://metadata.'):
                return Response(next(responses))
            raise urllib.error.HTTPError(
                request.full_url,
                403,
                'raw provider text must not escape',
                {},
                None,
            )

        client = RestPubSub(opener=opener, now=lambda: 0)
        with self.assertRaisesRegex(ControllerError, '^pubsub_permission_denied$'):
            client.verify_transport()

if __name__ == '__main__':
    unittest.main()
