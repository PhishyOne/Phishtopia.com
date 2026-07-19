from __future__ import annotations

import base64
import hashlib
import hmac
import unittest
import os
import socket
import struct
import sys
import tempfile
import urllib.parse
from pathlib import Path
from unittest import mock

import worker.platform as platform_module
from worker.platform import (
    OPS_PYTHON_TEST_COMMAND,
    CommandRunner,
    PlatformError,
    RealPlatform,
)


class PlatformSecurityTests(unittest.TestCase):
    def test_no_new_privileges_uses_fixed_setpriv_drop_not_sudo(self) -> None:
        command = RealPlatform._as_account(
            "postgres", ["/usr/bin/env", "HOME=/var/lib/postgresql", "/usr/bin/psql"]
        )
        self.assertEqual(command[0], "/usr/bin/setpriv")
        self.assertIn("--reuid=postgres", command)
        self.assertIn("--no-new-privs", command)
        self.assertNotIn("--bounding-set=-all", command)
        self.assertNotIn("sudo", " ".join(command))
        with self.assertRaisesRegex(PlatformError, "account_not_allowlisted"):
            RealPlatform._as_account("root", ["/usr/bin/env", "/usr/bin/id"])

    def test_crash_left_secret_temporary_is_removed_without_touching_other_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory_name:
            directory_path = Path(directory_name)
            stale = directory_path / ".env.ops-0123456789abcdef"
            unrelated = directory_path / ".env.ops-not-ours"
            stale.write_bytes(b"SESSION_SECRET=must-not-remain\n")
            unrelated.write_bytes(b"keep\n")
            descriptor = os.open(directory_path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                RealPlatform._cleanup_env_temporaries(descriptor)
            finally:
                os.close(descriptor)
            self.assertFalse(stale.exists())
            self.assertTrue(unrelated.exists())

    def test_action_specific_capacity_boundaries_fail_closed(self) -> None:
        platform = RealPlatform.__new__(RealPlatform)
        platform._memory_available = lambda: 639_999_999  # type: ignore[method-assign]
        with (
            mock.patch("worker.platform.os.geteuid", return_value=0),
            mock.patch(
                "worker.platform.shutil.disk_usage",
                return_value=mock.Mock(free=10_000_000_000),
            ),
        ):
            with self.assertRaisesRegex(PlatformError, "insufficient_memory_capacity"):
                platform.preflight(
                    {
                        "type": "upgrade_ops_release",
                        "commit": "a" * 40,
                        "artifactSha256": "b" * 64,
                    },
                    lambda: None,
                )

        platform._database_size_bytes = lambda: 500_000_000  # type: ignore[method-assign]
        platform._memory_available = lambda: 900_000_000  # type: ignore[method-assign]
        with (
            mock.patch("worker.platform.os.geteuid", return_value=0),
            mock.patch(
                "worker.platform.shutil.disk_usage",
                return_value=mock.Mock(free=2_499_999_999),
            ),
        ):
            with self.assertRaisesRegex(PlatformError, "insufficient_disk_capacity"):
                platform.preflight(
                    {
                        "type": "run_tested_migration",
                        "commit": "a" * 40,
                        "artifactSha256": "b" * 64,
                        "migrationId": "20260718000000_bootstrap",
                    },
                    lambda: None,
                )

    def test_command_runner_rejects_shells_and_control_characters_before_spawn(self) -> None:
        runner = CommandRunner()
        with self.assertRaisesRegex(PlatformError, "command_not_allowlisted"):
            runner.run(["/bin/sh", "-c", "id"], timeout=1)
        with self.assertRaisesRegex(PlatformError, "unsafe_command_argument"):
            runner.run(["/usr/bin/gcloud", "projects\nlist"], timeout=1)

    def test_command_runner_terminates_output_flood_at_fixed_quota(self) -> None:
        runner = CommandRunner()
        with (
            mock.patch.object(CommandRunner, "EXECUTABLES", frozenset({sys.executable})),
            self.assertRaisesRegex(PlatformError, "command_output_too_large"),
        ):
            runner.run(
                [
                    sys.executable,
                    "-c",
                    "import os;os.write(1,b'x'*3000000)",
                ],
                timeout=5,
            )

    def test_cancel_cleanup_stops_only_exact_build_transient_unit(self) -> None:
        unit = "phishtopia-build-aaaaaaaaaaaa"
        with mock.patch(
            "worker.platform.subprocess.run",
            side_effect=[mock.Mock(returncode=0), mock.Mock(returncode=3)],
        ) as stopped:
            CommandRunner._stop_transient_unit(
                ["/usr/bin/systemd-run", f"--unit={unit}", "--", "/usr/bin/node"]
            )
            self.assertEqual(stopped.call_count, 2)

    def test_disposable_app_test_sandbox_allows_loopback_only_in_private_namespace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate = root / ("extract-" + "a" * 40)
            candidate.mkdir()
            captured: list[str] = []
            platform = RealPlatform.__new__(RealPlatform)
            platform._guard = None
            platform._run = lambda command, **_kwargs: captured.extend(command) or b""  # type: ignore[method-assign]
            with (
                mock.patch.object(platform_module, "STAGING_ROOT", root),
                mock.patch("worker.platform.pwd.getpwnam", return_value=mock.Mock()),
            ):
                platform._sandbox_run(
                    candidate,
                    [str(platform_module.OPS_NODE), "--test"],
                    timeout=30,
                )
            self.assertIn("--property=PrivateNetwork=yes", captured)
            self.assertIn(
                "--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
                captured,
            )

    def test_candidate_python_tests_cannot_write_bytecode(self) -> None:
        self.assertEqual(OPS_PYTHON_TEST_COMMAND[:2], ("/usr/bin/python3", "-B"))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate = root / ("extract-" + "a" * 40)
            candidate.mkdir()
            captured: list[str] = []
            platform = RealPlatform.__new__(RealPlatform)
            platform._guard = None
            platform._run = (  # type: ignore[method-assign]
                lambda command, **_kwargs: captured.extend(command) or b""
            )
            with (
                mock.patch.object(platform_module, "STAGING_ROOT", root),
                mock.patch("worker.platform.pwd.getpwnam", return_value=mock.Mock()),
            ):
                platform._sandbox_run(
                    candidate,
                    list(OPS_PYTHON_TEST_COMMAND),
                    timeout=30,
                )
        self.assertIn("--setenv=PYTHONDONTWRITEBYTECODE=1", captured)
        separator = captured.index("--")
        self.assertEqual(captured[separator + 1 :], list(OPS_PYTHON_TEST_COMMAND))

    def test_session_secret_is_proved_by_application_cookie_signature(self) -> None:
        secret = "s" * 64
        session_id = "consumer-issued-session-id"
        signature = base64.b64encode(
            hmac.new(secret.encode(), session_id.encode(), hashlib.sha256).digest()
        ).decode().rstrip("=")
        cookie = "sid=" + urllib.parse.quote(
            f"s:{session_id}.{signature}", safe=""
        )
        self.assertTrue(RealPlatform._session_cookie_uses_secret(cookie, secret))
        self.assertFalse(
            RealPlatform._session_cookie_uses_secret(cookie, "w" * 64)
        )
        self.assertFalse(
            RealPlatform._session_cookie_uses_secret(cookie + "tampered", secret)
        )

    def test_general_production_invariants_use_schema_not_live_database_data(self) -> None:
        platform = RealPlatform.__new__(RealPlatform)
        platform._run = lambda *_args, **_kwargs: b""  # type: ignore[method-assign]
        platform._safe_env_read = lambda: b"fixed-config"  # type: ignore[method-assign]
        platform._database_schema_hash = lambda: "stable-schema"  # type: ignore[method-assign]
        platform._database_fingerprint = (  # type: ignore[method-assign]
            lambda *_args, **_kwargs: self.fail("live database data was read")
        )
        platform._cloud_run_service = lambda: {  # type: ignore[method-assign]
            "status": {"traffic": [{"revisionName": "fixed", "percent": 100}]}
        }
        platform._error_signal = lambda: {  # type: ignore[method-assign]
            "exists": True,
            "device": 1,
            "inode": 2,
            "size": 3,
            "markers": 0,
        }
        with (
            mock.patch("worker.platform.Path.rglob", return_value=[]),
            mock.patch(
                "worker.platform.socket.getaddrinfo",
                return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("34.73.92.179", 443))],
            ),
        ):
            invariants = platform._production_invariants()
        self.assertEqual(invariants["database_schema"], "stable-schema")
        self.assertNotIn("database", invariants)
        self.assertNotIn("data", invariants)

    def test_error_gate_uses_counts_only_and_rejects_new_errors_or_rotation(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            error_log = Path(directory) / "errors.log"
            error_log.write_text("[time] [ERROR] one\nstack\n", encoding="utf8")
            error_log.chmod(0o644)
            with mock.patch.object(platform_module, "APP_ERROR_LOG", error_log):
                baseline = RealPlatform._error_signal()
                self.assertEqual(baseline["markers"], 1)
                RealPlatform._verify_error_signal(baseline, RealPlatform._error_signal())
                with error_log.open("a", encoding="utf8") as handle:
                    handle.write("[time] [ERROR] two\n")
                with self.assertRaisesRegex(PlatformError, "post_change_error_detected"):
                    RealPlatform._verify_error_signal(
                        baseline, RealPlatform._error_signal()
                    )
                error_log.unlink()
                error_log.write_text("", encoding="utf8")
                error_log.chmod(0o644)
                with self.assertRaisesRegex(PlatformError, "error_signal_discontinuous"):
                    RealPlatform._verify_error_signal(
                        baseline, RealPlatform._error_signal()
                    )

    def test_cloud_run_session_secret_consumer_is_rejected_before_rotation(self) -> None:
        platform = RealPlatform.__new__(RealPlatform)
        platform._cloud_run_service = lambda: {  # type: ignore[method-assign]
            "spec": {
                "template": {
                    "spec": {
                        "containers": [
                            {
                                "env": [
                                    {
                                        "name": "SESSION_SECRET",
                                        "valueFrom": {"secretKeyRef": {"name": "session"}},
                                    }
                                ]
                            }
                        ]
                    }
                }
            }
        }
        with self.assertRaisesRegex(
            PlatformError, "cloud_run_session_secret_consumer_unsupported"
        ):
            platform._assert_cloud_run_not_session_secret_consumer()
            self.assertEqual(stopped.call_args_list[0].args[0], ["/usr/bin/systemctl", "stop", unit])
            CommandRunner._stop_transient_unit(
                ["/usr/bin/systemd-run", "--unit=attacker.service"]
            )
            self.assertEqual(stopped.call_count, 2)

    def test_migration_archive_verification_uses_bound_job_guard(self) -> None:
        platform = RealPlatform.__new__(RealPlatform)
        calls: list[str] = []

        def guard() -> None:
            calls.append("guard")
            raise PlatformError("cancel_requested")

        def archive(
            _commit: str, _digest: str, archive_check: object
        ) -> object:
            self.assertIs(archive_check, guard)
            archive_check()  # type: ignore[operator]
            raise AssertionError("guard should have interrupted archive verification")

        platform.bind_guard(guard)
        platform._verified_archive = archive  # type: ignore[method-assign]
        with self.assertRaisesRegex(PlatformError, "cancel_requested"):
            platform._migration_spec(
                {
                    "commit": "a" * 40,
                    "artifactSha256": "b" * 64,
                    "migrationId": "20260718000000_bootstrap",
                }
            )
        self.assertEqual(calls, ["guard"])

    def test_first_release_sql_policy_rejects_data_and_destructive_statements(self) -> None:
        for sql in (
            "DROP TABLE users;",
            "TRUNCATE session;",
            "UPDATE users SET password = 'x';",
            "COPY users TO PROGRAM 'id';",
            "\\include /etc/passwd",
        ):
            with self.subTest(sql=sql):
                self.assertTrue(RealPlatform._unsafe_sql(sql))
        self.assertFalse(
            RealPlatform._unsafe_sql(
                "CREATE INDEX CONCURRENTLY cannot_run_in_transaction ON users (id);"
            )
        )

    def test_authoritative_dns_parser_requires_aa_and_returns_only_requested_type(self) -> None:
        identifier = 1234
        question = b"\x0aphishtopia\x03com\x00" + struct.pack("!HH", 1, 1)
        answer = (
            b"\xc0\x0c"
            + struct.pack("!HHIH", 1, 1, 300, 4)
            + socket.inet_aton("34.73.92.179")
        )
        packet = struct.pack("!HHHHHH", identifier, 0x8400, 1, 1, 0, 0) + question + answer
        self.assertEqual(
            RealPlatform._parse_dns_answers(
                packet, identifier, 1, require_authoritative=True
            ),
            {"34.73.92.179"},
        )
        non_authoritative = bytearray(packet)
        non_authoritative[2:4] = struct.pack("!H", 0x8000)
        with self.assertRaises(PlatformError):
            RealPlatform._parse_dns_answers(
                bytes(non_authoritative),
                identifier,
                1,
                require_authoritative=True,
            )


if __name__ == "__main__":
    unittest.main()
