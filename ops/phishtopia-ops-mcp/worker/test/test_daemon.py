from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest import mock

import worker.daemon as daemon_module
from worker.allowlist import ValidationError
from worker.daemon import WorkerApplication
from worker.store import JobStore


class NoopExecutor:
    def execute(self, _row: object) -> None:
        raise AssertionError("queued integration test must not execute")


class RuntimePreflightExecutor(NoopExecutor):
    class Platform:
        @staticmethod
        def runtime_preflight_contract() -> dict[str, str]:
            return {
                "pm2": "passed",
                "postgres": "passed",
                "mcpUser": "passed",
                "gcloudIdentity": "passed",
                "dnsRollback": "passed",
            }

    platform = Platform()


class DaemonProtocolTests(unittest.TestCase):
    def test_reexec_changes_to_selected_release_before_exec(self) -> None:
        events: list[tuple[str, object]] = []

        def changed(directory: object) -> None:
            events.append(("chdir", directory))

        def executed(executable: str, arguments: list[str]) -> None:
            events.append(("execv", (executable, arguments)))

        with (
            mock.patch("worker.daemon.os.chdir", side_effect=changed),
            mock.patch("worker.daemon.os.execv", side_effect=executed),
        ):
            daemon_module.reexec_selected_worker()
        self.assertEqual(
            events,
            [
                ("chdir", daemon_module.OPS_CURRENT),
                (
                    "execv",
                    (
                        "/usr/bin/python3",
                        ["/usr/bin/python3", "-m", "worker.daemon"],
                    ),
                ),
            ],
        )

    def test_internal_runtime_preflight_is_fixed_and_sanitized(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = JobStore(root / "jobs.sqlite3", root / "audit.jsonl")
            application = WorkerApplication(store, RuntimePreflightExecutor())  # type: ignore[arg-type]
            result = application.handle(
                {"operation": "get_runtime_preflight", "payload": {}}
            )
            self.assertEqual(
                result["preflight"],
                {
                    "pm2": "passed",
                    "postgres": "passed",
                    "mcpUser": "passed",
                    "gcloudIdentity": "passed",
                    "dnsRollback": "passed",
                },
            )
            with self.assertRaises(ValidationError):
                application.handle(
                    {"operation": "get_runtime_preflight", "payload": {"command": "id"}}
                )

    def test_bootstrap_gate_blocks_only_new_mutations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            active = root / "bootstrap-active"
            active.write_text("staged\n")
            store = JobStore(root / "jobs.sqlite3", root / "audit.jsonl")
            application = WorkerApplication(store, NoopExecutor())  # type: ignore[arg-type]
            with mock.patch.object(daemon_module, "BOOTSTRAP_ACTIVE", active):
                contract = application.handle(
                    {"operation": "get_contract", "payload": {}}
                )
                self.assertTrue(contract["ok"])
                with self.assertRaisesRegex(
                    ValidationError, "bootstrap_not_committed"
                ):
                    application.handle(
                        {
                            "operation": "start_job",
                            "payload": {
                                "idempotencyKey": "restart-staged-0001",
                                "action": {
                                    "type": "restart_phishtopia_service",
                                    "service": "phishtopia_app",
                                },
                            },
                        }
                    )

    def test_root_protocol_revalidates_start_status_and_cancel(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            store = JobStore(root / "jobs.sqlite3", root / "audit.jsonl")
            application = WorkerApplication(store, NoopExecutor())  # type: ignore[arg-type]
            started = application.handle(
                {
                    "operation": "start_job",
                    "payload": {
                        "idempotencyKey": "restart-0001",
                        "action": {
                            "type": "restart_phishtopia_service",
                            "service": "phishtopia_app",
                        },
                    },
                }
            )
            self.assertTrue(started["ok"])
            job_id = started["job"]["jobId"]
            status = application.handle(
                {"operation": "get_job_status", "payload": {"jobId": job_id}}
            )
            self.assertEqual(status["job"]["state"], "queued")
            cancelled = application.handle(
                {"operation": "cancel_job", "payload": {"jobId": job_id}}
            )
            self.assertEqual(cancelled["job"]["state"], "cancelled")


if __name__ == "__main__":
    unittest.main()
