from __future__ import annotations
import json
import unittest
import uuid
from unittest.mock import patch
from controller.policy import COMMAND_PREFIX, ControllerError, decode_pubsub_message, encode_pubsub_message, parse_issue_comment_event, validate_request_envelope, validate_worker_response
from controller.pubsub import PulledMessage

QUEUE = 41
JOB_ID = '123e4567-e89b-42d3-a456-426614174000'

def event(command=None):
    command = command or {'operation': 'start_job', 'payload': {'action': {'type': 'restart_phishtopia_service', 'service': 'phishtopia_app'}}}
    return {'action': 'created', 'repository': {'full_name': 'PhishyOne/Phishtopia.com', 'id': 997939289}, 'issue': {'number': QUEUE, 'locked': True}, 'comment': {'id': 987654321, 'body': COMMAND_PREFIX + '\n' + json.dumps(command), 'author_association': 'OWNER', 'user': {'login': 'PhishyOne', 'id': 123998606, 'type': 'User'}}}

def job_response():
    return {'ok': True, 'job': {'jobId': JOB_ID, 'action': 'restart_phishtopia_service', 'state': 'queued', 'progress': 0, 'createdAt': '2026-07-24T12:00:00Z', 'updatedAt': '2026-07-24T12:00:00Z', 'deadlineAt': '2026-07-24T12:03:00Z', 'resultCode': 'accepted', 'observations': []}}

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

if __name__ == '__main__':
    unittest.main()
