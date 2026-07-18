from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from worker.store import JobStore, StoreError


ACTION = {"type": "restart_phishtopia_service", "service": "phishtopia_app"}


class StoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.store = JobStore(root / "jobs.sqlite3", root / "audit.jsonl")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_idempotent_replay_returns_the_same_job(self) -> None:
        first = self.store.start("request-0001", ACTION)
        second = self.store.start("request-0001", ACTION)
        self.assertEqual(first["jobId"], second["jobId"])

    def test_idempotency_key_cannot_be_reused_for_another_request(self) -> None:
        self.store.start("request-0001", ACTION)
        with self.assertRaisesRegex(StoreError, "idempotency_conflict"):
            self.store.start("request-0001", {"type": "restart_phishtopia_service", "service": "phishtopia_ops_tunnel"})

    def test_single_flight_is_enforced_per_protected_resource(self) -> None:
        self.store.start("request-0001", ACTION)
        with self.assertRaisesRegex(StoreError, "resource_busy"):
            self.store.start("request-0002", ACTION)

    def test_cancelled_queued_job_is_terminal_without_execution(self) -> None:
        job = self.store.start("request-0001", ACTION)
        cancelled = self.store.cancel(job["jobId"])
        self.assertEqual(cancelled["state"], "cancelled")
        self.assertEqual(cancelled["resultCode"], "cancelled_and_rolled_back")

    def test_cancel_replay_is_terminal_and_does_not_amplify_audit(self) -> None:
        job = self.store.start("request-0001", ACTION)
        first = self.store.cancel(job["jobId"])
        audit = self.store.audit.read_bytes()
        for _ in range(100):
            self.assertEqual(self.store.cancel(job["jobId"]), first)
        self.assertEqual(self.store.audit.read_bytes(), audit)

    def test_start_preview_is_bounded_and_never_echoes_dns_target(self) -> None:
        target = "phishtopia-ht3gdpkzmq-ue.a.run.app"
        job = self.store.start(
            "request-0001",
            {
                "type": "update_dns_with_rollback",
                "hostname": "www.phishtopia.com",
                "recordType": "CNAME",
                "value": target,
                "ttl": 300,
            },
        )
        self.assertLessEqual(len(job["observations"]), 6)
        self.assertNotIn(target, json.dumps(job))
        self.assertIn("www.phishtopia.com", json.dumps(job))

    def test_audit_is_sanitized_and_does_not_copy_action_arguments(self) -> None:
        self.store.start("request-0001", ACTION)
        entries = [json.loads(line) for line in (Path(self.temporary.name) / "audit.jsonl").read_text().splitlines()]
        self.assertEqual(entries[0]["action"], "restart_phishtopia_service")
        self.assertNotIn("action_json", entries[0])
        self.assertNotIn("idempotency_key", entries[0])
        self.assertEqual(entries[0]["resource"], "production_mutation")
        self.assertNotIn("phishtopia_app", json.dumps(entries[0]))

    def test_interrupted_job_is_recovered_for_baseline_rollback(self) -> None:
        job = self.store.start("request-0001", ACTION)
        row = self.store.next_job()
        self.assertIsNotNone(row)
        self.store.transition(job["jobId"], baseline={"fixed": "baseline"}, progress=50)
        recovered = JobStore(
            Path(self.temporary.name) / "jobs.sqlite3",
            Path(self.temporary.name) / "audit.jsonl",
        ).next_job()
        self.assertIsNotNone(recovered)
        assert recovered is not None
        self.assertEqual(recovered["state"], "running")
        self.assertEqual(json.loads(recovered["baseline_json"]), {"fixed": "baseline"})


if __name__ == "__main__":
    unittest.main()
