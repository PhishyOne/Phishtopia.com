from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from typing import Any, Callable

from worker.executor import JobExecutor
from worker.platform import PlatformError
from worker.store import JobStore


ACTION = {"type": "restart_phishtopia_service", "service": "phishtopia_app"}
OPS_ACTION = {
    "type": "upgrade_ops_release",
    "commit": "a" * 40,
    "artifactSha256": "b" * 64,
}


class FakePlatform:
    def __init__(self, store: JobStore, *, fail: str | None = None, cancel: bool = False, rollback_fails: bool = False):
        self.store = store
        self.fail = fail
        self.cancel_during_perform = cancel
        self.rollback_fails = rollback_fails
        self.calls: list[str] = []
        self.guard: Callable[[], None] | None = None

    def bind_guard(self, guard: Callable[[], None] | None) -> None:
        self.guard = guard

    def preflight(self, action: dict[str, Any], check: Callable[[], None]) -> None:
        self.calls.append("preflight")
        check()
        if self.fail == "preflight":
            raise RuntimeError("credential=must-not-escape")

    def capture(self, action: dict[str, Any], job_id: str) -> dict[str, Any]:
        self.calls.append("capture")
        return {"fixed": "baseline"}

    def perform(self, action: dict[str, Any], job_id: str, baseline: dict[str, Any], check: Callable[[], None], progress: Callable[[int, str], None], mutation: Callable[[], None]) -> list[dict[str, str]]:
        self.calls.append("perform")
        progress(50, "fake_resource")
        if self.fail == "perform_before_mutation":
            raise RuntimeError("invalid target")
        mutation()
        if self.cancel_during_perform:
            self.store.cancel(job_id)
            check()
        if self.fail == "perform":
            raise RuntimeError("authorization=must-not-escape")
        return [{"name": "result", "value": "token=must-not-escape completed"}]

    def rollback(self, action: dict[str, Any], baseline: dict[str, Any]) -> None:
        self.calls.append("rollback")
        if self.guard is not None:
            self.guard()
        if self.rollback_fails:
            raise PlatformError("restore_target_failed")


class ExecutorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        root = Path(self.temporary.name)
        self.store = JobStore(root / "jobs.sqlite3", root / "audit.jsonl")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def _row(self, key: str = "request-0001") -> Any:
        job = self.store.start(key, ACTION)
        row = self.store.next_job()
        self.assertIsNotNone(row)
        return row

    def test_success_uses_fakes_and_redacts_output(self) -> None:
        fake = FakePlatform(self.store)
        row = self._row()
        JobExecutor(self.store, fake).execute(row)  # type: ignore[arg-type]
        status = self.store.get(row["job_id"])
        self.assertEqual(status["state"], "succeeded")
        self.assertNotIn("must-not-escape", str(status))
        self.assertEqual(fake.calls, ["preflight", "capture", "perform"])

    def test_failure_after_baseline_rolls_back(self) -> None:
        fake = FakePlatform(self.store, fail="perform")
        row = self._row()
        JobExecutor(self.store, fake).execute(row)  # type: ignore[arg-type]
        status = self.store.get(row["job_id"])
        self.assertEqual(status["resultCode"], "failed_and_rolled_back")
        self.assertEqual(fake.calls[-1], "rollback")

    def test_semantic_failure_before_mutation_never_rolls_back(self) -> None:
        fake = FakePlatform(self.store, fail="perform_before_mutation")
        row = self._row()
        JobExecutor(self.store, fake).execute(row)  # type: ignore[arg-type]
        status = self.store.get(row["job_id"])
        self.assertEqual(status["resultCode"], "failed_without_mutation")
        self.assertNotIn("rollback", fake.calls)

    def test_cancellation_rolls_back(self) -> None:
        fake = FakePlatform(self.store, cancel=True)
        row = self._row()
        JobExecutor(self.store, fake).execute(row)  # type: ignore[arg-type]
        status = self.store.get(row["job_id"])
        self.assertEqual(status["state"], "cancelled")
        self.assertEqual(status["resultCode"], "cancelled_and_rolled_back")
        self.assertEqual(fake.calls[-1], "rollback")

    def test_preflight_failure_makes_no_mutation_and_fails_closed(self) -> None:
        fake = FakePlatform(self.store, fail="preflight")
        row = self._row()
        JobExecutor(self.store, fake).execute(row)  # type: ignore[arg-type]
        status = self.store.get(row["job_id"])
        self.assertEqual(status["resultCode"], "preflight_rejected")
        self.assertEqual(fake.calls, ["preflight"])

    def test_rollback_failure_is_not_misreported(self) -> None:
        fake = FakePlatform(self.store, fail="perform", rollback_fails=True)
        row = self._row()
        JobExecutor(self.store, fake).execute(row)  # type: ignore[arg-type]
        status = self.store.get(row["job_id"])
        self.assertEqual(status["resultCode"], "rollback_failed")
        self.assertIn(
            {"name": "rollback_error_code", "value": "restore_target_failed"},
            status["observations"],
        )
        self.assertNotIn("authorization=must-not-escape", str(status))
        self.assertIn(
            '"rollback_error_code":"restore_target_failed"',
            self.store.audit.read_text(encoding="utf8"),
        )

    def test_restarted_job_uses_persisted_baseline_only_for_rollback(self) -> None:
        fake = FakePlatform(self.store)
        row = self._row()
        self.store.transition(
            row["job_id"],
            baseline={"fixed": "baseline"},
            checkpoint={"stage": "mutation_started", "mutationStarted": True},
            progress=50,
        )
        restarted_row = self.store.raw(row["job_id"])
        JobExecutor(self.store, fake).execute(restarted_row)  # type: ignore[arg-type]
        self.assertEqual(fake.calls, ["rollback"])
        self.assertEqual(self.store.get(row["job_id"])["resultCode"], "failed_and_rolled_back")

    def test_restarted_job_before_mutation_marker_skips_rollback(self) -> None:
        fake = FakePlatform(self.store)
        row = self._row()
        self.store.transition(row["job_id"], baseline={"fixed": "baseline"}, progress=10)
        JobExecutor(self.store, fake).execute(self.store.raw(row["job_id"]))  # type: ignore[arg-type]
        self.assertEqual(fake.calls, [])
        self.assertEqual(
            self.store.get(row["job_id"])["resultCode"], "failed_without_mutation"
        )

    def test_restarted_ops_handoff_is_verified_before_durable_success(self) -> None:
        class HandoffPlatform(FakePlatform):
            def complete_ops_handoff(
                self,
                _action: dict[str, Any],
                _baseline: dict[str, Any],
                check: Callable[[], None],
            ) -> list[dict[str, str]]:
                self.calls.append("complete_handoff")
                check()
                return [{"name": "root_worker", "value": "reexec_verified"}]

        fake = HandoffPlatform(self.store)
        job = self.store.start("ops-handoff-0001", OPS_ACTION)
        self.store.next_job()
        self.store.transition(
            job["jobId"],
            baseline={"fixed": "baseline"},
            checkpoint={
                "stage": "worker_handoff_pending",
                "mutationStarted": True,
            },
            progress=95,
        )
        JobExecutor(self.store, fake).execute(self.store.raw(job["jobId"]))  # type: ignore[arg-type]
        status = self.store.get(job["jobId"])
        self.assertEqual(status["state"], "succeeded")
        self.assertEqual(
            status["observations"],
            [{"name": "root_worker", "value": "reexec_verified"}],
        )
        self.assertEqual(fake.calls, ["complete_handoff"])


if __name__ == "__main__":
    unittest.main()
