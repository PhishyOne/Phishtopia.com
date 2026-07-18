from __future__ import annotations

import copy
import os
import tempfile
import unittest
from pathlib import Path
from typing import Any, Callable
from unittest import mock

import worker.platform as platform_module
from worker.platform import PlatformError, RealPlatform, WorkerHandoffRequested


COMMIT = "a" * 40
DIGEST = "b" * 64
JOB_ID = "12345678-1234-4123-8123-123456789abc"


def check() -> None:
    return None


def progress(_value: int, _stage: str) -> None:
    return None


class ScriptedPlatform(RealPlatform):
    def __init__(self) -> None:
        self._guard = None
        self.events: list[str] = []

    def _verify_production_invariants(
        self, _baseline: dict[str, Any], *, ignored: frozenset[str] = frozenset()
    ) -> None:
        self.events.append("invariants:" + ",".join(sorted(ignored)))

    def _public_health(self, _url: str) -> None:
        self.events.append("public_health")

    def _verify_session_cookie(
        self, *, expected_session_secret: str | None = None
    ) -> None:
        self.events.append(
            "session_secret_consumer" if expected_session_secret else "session"
        )

    def _verify_tls(self) -> None:
        self.events.append("tls")

    def _pm2(self, *arguments: str, timeout: int) -> bytes:
        self.events.append("pm2:" + ":".join(arguments))
        return b""

    def _pm2_status(self) -> dict[str, Any]:
        self.events.append("pm2_status")
        return {"name": "phishtopia", "status": "online", "pid": 1}

    def _systemctl(self, verb: str, unit: str, *, timeout: int) -> bytes:
        self.events.append(f"systemctl:{verb}:{unit}")
        return b"active\n"

    def _verify_ops(self) -> None:
        self.events.append("verify_ops")


class CanaryFake(ScriptedPlatform):
    def __init__(self, errors: int = 0) -> None:
        super().__init__()
        self.errors = errors
        self.health_probes = 0
        self.service = {
            "status": {
                "url": "https://phishtopia-base-ue.a.run.app",
                "latestReadyRevisionName": "phishtopia-00041-pqc",
                "traffic": [
                    {"revisionName": "phishtopia-00040-cdb", "percent": 100}
                ],
            }
        }

    def _cloud_run_service(self) -> dict[str, Any]:
        return copy.deepcopy(self.service)

    def _gcloud_json(self, *arguments: str, timeout: int) -> Any:
        if arguments[:3] == ("run", "revisions", "list"):
            return [
                {
                    "metadata": {"name": "phishtopia-00041-pqc"},
                    "status": {"conditions": [{"type": "Ready", "status": "True"}]},
                }
            ]
        raise AssertionError(arguments)

    def _gcloud(
        self, *arguments: str, timeout: int, input_bytes: bytes | None = None
    ) -> bytes:
        del timeout, input_bytes
        self.events.append("traffic_mutation")
        if any(value.startswith("--set-tags=") for value in arguments):
            self.service["status"]["traffic"].append(
                {
                    "revisionName": "phishtopia-00041-pqc",
                    "percent": 0,
                    "tag": "ops-canary",
                    "url": "https://ops-canary---phishtopia-ue.a.run.app",
                }
            )
        for value in arguments:
            if value.startswith("--to-revisions="):
                traffic = []
                for mapping in value.split("=", 1)[1].split(","):
                    revision, percentage = mapping.split("=")
                    item: dict[str, Any] = {
                        "revisionName": revision,
                        "percent": int(percentage),
                    }
                    if revision == "phishtopia-00041-pqc":
                        item.update(
                            {
                                "tag": "ops-canary",
                                "url": "https://ops-canary---phishtopia-ue.a.run.app",
                            }
                        )
                    traffic.append(item)
                self.service["status"]["traffic"] = traffic
        if "--remove-tags=ops-canary" in arguments or "--clear-tags" in arguments:
            for item in self.service["status"]["traffic"]:
                item.pop("tag", None)
                item.pop("url", None)
        return b""

    def _revision_error_count(self, _revision: str) -> int:
        return self.errors

    def _cloud_run_health_url(self, value: str) -> None:
        self.assert_candidate_url(value)
        self.health_probes += 1

    @staticmethod
    def assert_candidate_url(value: str) -> None:
        if not value.startswith("https://ops-canary---"):
            raise AssertionError("canary probe did not target candidate")

    def _pause(self, _seconds: int) -> None:
        self.events.append("dwell")


class DnsFake(ScriptedPlatform):
    def __init__(self) -> None:
        super().__init__()
        self.payloads: list[dict[str, Any]] = []

    def _dns_token(self) -> str:
        return "t" * 40

    def _cloudflare_zone_and_record(
        self, action: dict[str, Any], token: str
    ) -> tuple[str, dict[str, Any], list[str]]:
        del action, token
        return "a" * 32, {
            "id": "b" * 32,
            "name": "phishtopia.com",
            "type": "A",
            "content": "34.73.92.179",
            "ttl": 300,
            "proxied": False,
        }, ["a.ns.cloudflare.com", "b.ns.cloudflare.com"]

    def _cloudflare_request(
        self,
        path: str,
        token: str,
        *,
        method: str = "GET",
        payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        del path, token, method
        if payload is not None:
            self.payloads.append(payload)
        return {"success": True}

    def _wait_dns(self, action: dict[str, Any], nameservers: list[str]) -> None:
        del action, nameservers
        self.events.append("dns_converged")

    def _public_hostname_health(self, hostname: str) -> None:
        self.events.append("hostname_health:" + hostname)


class SecretFake(ScriptedPlatform):
    def __init__(self, initial: bytes) -> None:
        super().__init__()
        self.env = initial
        self.enabled = {"1"}

    def _safe_env_read(self) -> bytes:
        return self.env

    def _safe_env_write(self, _directory: Path, data: bytes) -> None:
        self.env = data

    def _secret_versions(self) -> list[str]:
        return sorted(self.enabled)

    def _gcloud(
        self, *arguments: str, timeout: int, input_bytes: bytes | None = None
    ) -> bytes:
        del timeout, input_bytes
        if arguments[:4] == ("secrets", "versions", "add", "phishtopia-session-secret"):
            self.enabled.add("2")
            return b"projects/p/secrets/phishtopia-session-secret/versions/2\n"
        version = arguments[3]
        if arguments[2] == "disable":
            self.enabled.discard(version)
        elif arguments[2] == "enable":
            self.enabled.add(version)
        return b""


class MigrationFake(ScriptedPlatform):
    spec = {
        "column": "expire",
        "index": "ops_20260718000000_bcecad24dba8_idx",
        "operation": "create_index",
        "schema": "public",
        "table": "session",
    }

    def __init__(self) -> None:
        super().__init__()
        self.indexes: set[str] = set()
        self.gcloud_commands: list[tuple[str, ...]] = []

    def _migration_spec(self, _action: dict[str, Any]) -> dict[str, str]:
        return dict(self.spec)

    def _index_exists(self, database: str, _spec: dict[str, str]) -> bool:
        return database in self.indexes

    def _apply_index_change(
        self, database: str, _spec: dict[str, str], *, create: bool
    ) -> None:
        if create:
            self.indexes.add(database)
        else:
            self.indexes.discard(database)

    def _database_fingerprint(self, database: str = "phishtopia") -> dict[str, str]:
        return {
            "schema": "with-index" if database in self.indexes else "baseline",
            "data": "same-data",
        }

    def _postgres(self, executable: str, *arguments: str, timeout: int) -> bytes:
        del timeout
        if executable.endswith("pg_dump"):
            dump = Path(arguments[arguments.index("-f") + 1])
            dump.write_bytes(b"fake-dump")
            dump.chmod(0o600)
        if executable.endswith("dropdb"):
            self.events.append("rehearsal_dropped")
        return b""

    def _gcloud(
        self, *arguments: str, timeout: int, input_bytes: bytes | None = None
    ) -> bytes:
        del timeout, input_bytes
        self.gcloud_commands.append(arguments)
        return b""

    def _gcloud_json(self, *arguments: str, timeout: int) -> Any:
        del timeout
        if arguments[:3] == ("storage", "objects", "list"):
            return [
                {
                    "name": f"postgres/ops/{JOB_ID}.dump",
                    "generation": "123456789",
                }
            ]
        return {"size": "9", "crc32c": "AAAAAA=="}


class ReleaseFake(ScriptedPlatform):
    def __init__(self, archive_root: Path) -> None:
        super().__init__()
        self.archive_root = archive_root
        self.current = "baseline"
        self.manifest: dict[str, Any] = {
            "phishtopia_app": {},
            "phishtopia_ops": {},
        }
        self.fail_after_switch = False

    def _verify_production_invariants(
        self, baseline: dict[str, Any], *, ignored: frozenset[str] = frozenset()
    ) -> None:
        if self.fail_after_switch:
            self.fail_after_switch = False
            raise PlatformError("injected_post_switch_failure")
        super()._verify_production_invariants(baseline, ignored=ignored)

    def _verified_archive(
        self, _commit: str, _digest: str, _check: Callable[[], None]
    ) -> Path:
        return self.archive_root

    def _prepare_candidate(
        self, candidate: Path, *, dependency_source: Path, kind: str
    ) -> None:
        del candidate, dependency_source
        self.events.append(f"candidate_tested:{kind}")

    def _install_release(self, source: Path, destination: Path) -> None:
        del source
        destination.mkdir(parents=True)
        self.events.append("release_installed")

    def _switch_symlink(self, _current: Path, target: Path) -> None:
        self.current = target.name
        self.events.append("release_switched")

    def _restore_target(self, _current: Path, target: Any) -> None:
        self.current = str(target)
        self.events.append("release_restored")

    def _record_release(self, target: str, commit: str, digest: str) -> None:
        self.manifest[target][commit] = {"sha256": digest, "treeSha256": "tree"}

    def _release_manifest(self) -> dict[str, Any]:
        return copy.deepcopy(self.manifest)

    def _restore_release_manifest(self, value: Any) -> None:
        if not isinstance(value, dict):
            raise PlatformError("release_manifest_baseline_invalid")
        self.manifest = copy.deepcopy(value)

    def _tree_digest(self, _root: Path) -> str:
        return "tree"

    def _safe_env_read(self) -> bytes:
        return b"SESSION_SECRET=" + b"x" * 48 + b"\n"

    def _safe_env_write(self, _directory: Path, _data: bytes) -> None:
        self.events.append("env_copied")

    def _verify_immutable_unit_contract(self, _source: Path) -> None:
        self.events.append("unit_contract_verified")

    def _request_worker_reexec(self) -> None:
        self.events.append("worker_reexec_requested")


class ActionWorkflowFakeTests(unittest.TestCase):
    def test_restart_success_and_rollback_use_only_fixed_service(self) -> None:
        fake = ScriptedPlatform()
        action = {"type": "restart_phishtopia_service", "service": "phishtopia_app"}
        baseline = {"production_invariants": {}}
        fake._restart(action, baseline, check, progress)
        fake.rollback(action, baseline)
        self.assertEqual(fake.events.count("pm2:reload:phishtopia:--update-env"), 2)

    def test_canary_targets_candidate_and_fails_closed_on_any_recent_error(self) -> None:
        action = {
            "type": "canary_and_promote",
            "revision": "phishtopia-00041-pqc",
            "percentages": [5, 100],
        }
        baseline = {"production_invariants": {}, "traffic": []}
        fake = CanaryFake()
        fake._canary(action, baseline, check, progress)
        self.assertGreaterEqual(fake.health_probes, 5)
        self.assertEqual(
            fake._traffic_percentages(fake._cloud_run_service()),
            {"phishtopia-00041-pqc": 100},
        )
        rejected = CanaryFake(errors=50)
        with self.assertRaisesRegex(PlatformError, "candidate_has_recent_errors"):
            rejected._canary(action, baseline, check, progress)
        self.assertNotIn("traffic_mutation", rejected.events)

        tagged = CanaryFake()
        tagged.service["status"]["traffic"][0].update(
            {"tag": "existing", "url": "https://existing---phishtopia-ue.a.run.app"}
        )
        with self.assertRaisesRegex(PlatformError, "unsupported_traffic_baseline"):
            tagged._canary(action, baseline, check, progress)
        self.assertNotIn("traffic_mutation", tagged.events)

        old = CanaryFake()
        old.service["status"]["latestReadyRevisionName"] = "phishtopia-00042-xyz"
        with self.assertRaisesRegex(PlatformError, "revision_not_latest_ready"):
            old._canary(action, baseline, check, progress)
        self.assertNotIn("traffic_mutation", old.events)

    def test_dns_success_and_rollback_restore_exact_record(self) -> None:
        action = {
            "type": "update_dns_with_rollback",
            "hostname": "phishtopia.com",
            "recordType": "A",
            "value": "34.73.92.179",
            "ttl": 300,
        }
        original = {
            "zone": "a" * 32,
            "record": {
                "id": "b" * 32,
                "name": "phishtopia.com",
                "type": "A",
                "content": "34.73.92.179",
                "ttl": 300,
                "proxied": False,
            },
        }
        baseline = {"record": original, "production_invariants": {}}
        fake = DnsFake()
        fake._update_dns(action, baseline, check, progress)
        fake.rollback(action, baseline)
        self.assertEqual(fake.payloads[-1]["content"], "34.73.92.179")

    def test_secret_rotation_failure_path_restores_env_versions_and_deletes_backup(self) -> None:
        initial = b"SESSION_SECRET=" + b"o" * 48 + b"\n"
        fake = SecretFake(initial)
        with tempfile.TemporaryDirectory() as directory, mock.patch.object(
            platform_module, "ROLLBACK_ROOT", Path(directory)
        ):
            baseline = {
                "versions": ["1"],
                "env_backup": str(Path(directory) / f"{JOB_ID}.env"),
                "production_invariants": {},
            }
            action = {
                "type": "rotate_session_secret",
                "secret": "phishtopia-session-secret",
            }
            fake._rotate_secret(action, JOB_ID, baseline, check, progress)
            self.assertEqual(fake.enabled, {"2"})
            self.assertIn("session_secret_consumer", fake.events)
            fake.rollback(action, baseline)
            self.assertEqual(fake.env, initial)
            self.assertEqual(fake.enabled, {"1"})
            self.assertFalse(Path(baseline["env_backup"]).exists())

    def test_reversible_migration_rehearses_up_down_and_rollback_is_exact(self) -> None:
        fake = MigrationFake()
        action = {
            "type": "run_tested_migration",
            "commit": COMMIT,
            "artifactSha256": DIGEST,
            "migrationId": "20260718000000_session_expiry_index",
        }
        rehearsal = "ops_rehearsal_" + JOB_ID.replace("-", "")[:20]
        baseline = {
            "database": {"schema": "baseline", "data": "same-data"},
            "backup_object": f"gs://project-43a8be4b-69a7-4d52-805-phishtopia-backups/postgres/ops/{JOB_ID}.dump",
            "migration": dict(fake.spec),
            "index_present": False,
            "rehearsal": rehearsal,
            "production_invariants": {},
        }
        with (
            mock.patch.object(platform_module.os, "chown", return_value=None),
            mock.patch(
                "worker.platform.pwd.getpwnam",
                return_value=mock.Mock(pw_uid=os.getuid(), pw_gid=os.getgid()),
            ),
        ):
            fake._migration(action, JOB_ID, baseline, check, progress)
        self.assertIn("phishtopia", fake.indexes)
        fake.rollback(action, baseline)
        self.assertNotIn("phishtopia", fake.indexes)
        self.assertIn("rehearsal_dropped", fake.events)
        self.assertTrue(
            any(
                command[:2] == ("storage", "rm")
                and "--if-generation-match=123456789" in command
                for command in fake.gcloud_commands
            )
        )

    def test_migration_rollback_before_upload_treats_missing_object_as_complete(self) -> None:
        fake = MigrationFake()
        fake._gcloud_json = lambda *args, **kwargs: []  # type: ignore[method-assign]
        backup = f"gs://{platform_module.BACKUP_BUCKET}/postgres/ops/{JOB_ID}.dump"
        fake._delete_backup_if_present(backup)
        self.assertFalse(
            any(command[:2] == ("storage", "rm") for command in fake.gcloud_commands)
        )

    def test_upgrade_deploy_and_explicit_release_rollback_use_verified_fakes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "archive"
            ops = archive / "ops" / "phishtopia-ops-mcp"
            ops.mkdir(parents=True)
            (ops / "package-lock.json").write_text("{}")
            app_releases = root / "app-releases"
            ops_releases = root / "ops-releases"
            app_releases.mkdir()
            ops_releases.mkdir()
            current_app = root / "current-app"
            current_app.symlink_to(app_releases)
            fake = ReleaseFake(archive)
            with (
                mock.patch.object(platform_module, "APP_RELEASES", app_releases),
                mock.patch.object(platform_module, "OPS_RELEASES", ops_releases),
                mock.patch.object(platform_module, "APP_CURRENT", current_app),
            ):
                ops_action = {
                    "type": "upgrade_ops_release",
                    "commit": COMMIT,
                    "artifactSha256": DIGEST,
                }
                with self.assertRaises(WorkerHandoffRequested):
                    fake._upgrade_ops(
                        ops_action,
                        {
                            "destination_preexisting": False,
                            "release_destination": str(ops_releases / COMMIT),
                            "production_invariants": {},
                        },
                        check,
                        progress,
                    )
                app_action = {
                    "type": "deploy_verified_release",
                    "commit": COMMIT,
                    "artifactSha256": DIGEST,
                }
                fake._deploy_app(
                    app_action,
                    {
                        "destination_preexisting": False,
                        "release_destination": str(app_releases / COMMIT),
                        "production_invariants": {},
                    },
                    check,
                    progress,
                )
                target = ops_releases / COMMIT
                fake.manifest["phishtopia_ops"][COMMIT] = {
                    "sha256": DIGEST,
                    "treeSha256": "tree",
                }
                with self.assertRaises(WorkerHandoffRequested):
                    fake._rollback_release(
                        {
                            "type": "rollback_release",
                            "target": "phishtopia_ops",
                            "release": COMMIT,
                        },
                        {"production_invariants": {}},
                        check,
                        progress,
                    )
            self.assertIn("candidate_tested:ops", fake.events)
            self.assertIn("candidate_tested:app", fake.events)
            self.assertGreaterEqual(fake.events.count("release_switched"), 3)

    def test_failed_release_removes_only_new_destination_and_can_retry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "archive"
            source = archive / "ops" / "phishtopia-ops-mcp"
            source.mkdir(parents=True)
            (source / "package-lock.json").write_text("{}")
            releases = root / "ops-releases"
            releases.mkdir()
            action = {
                "type": "upgrade_ops_release",
                "commit": COMMIT,
                "artifactSha256": DIGEST,
            }
            baseline = {
                "current": str(releases / ("c" * 40)),
                "destination_preexisting": False,
                "release_destination": str(releases / COMMIT),
                "release_manifest": {
                    "phishtopia_app": {},
                    "phishtopia_ops": {},
                },
                "production_invariants": {},
            }
            fake = ReleaseFake(archive)
            fake.fail_after_switch = True
            with mock.patch.object(platform_module, "OPS_RELEASES", releases):
                with self.assertRaisesRegex(
                    PlatformError, "injected_post_switch_failure"
                ):
                    fake._upgrade_ops(action, baseline, check, progress)
                self.assertTrue((releases / COMMIT).is_dir())
                fake.rollback(action, baseline)
                self.assertFalse((releases / COMMIT).exists())
                with self.assertRaises(WorkerHandoffRequested):
                    fake._upgrade_ops(action, baseline, check, progress)
            self.assertTrue((releases / COMMIT).is_dir())

    def test_existing_release_is_rejected_before_mutation_marker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "archive"
            source = archive / "ops" / "phishtopia-ops-mcp"
            source.mkdir(parents=True)
            (source / "package-lock.json").write_text("{}")
            releases = root / "ops-releases"
            destination = releases / COMMIT
            destination.mkdir(parents=True)
            fake = ReleaseFake(archive)
            with mock.patch.object(platform_module, "OPS_RELEASES", releases):
                with self.assertRaisesRegex(PlatformError, "release_destination_exists"):
                    fake._upgrade_ops(
                        {
                            "type": "upgrade_ops_release",
                            "commit": COMMIT,
                            "artifactSha256": DIGEST,
                        },
                        {
                            "destination_preexisting": True,
                            "release_destination": str(destination),
                            "production_invariants": {},
                        },
                        check,
                        progress,
                        lambda: fake.events.append("mutation_marker"),
                    )
            self.assertNotIn("mutation_marker", fake.events)
            self.assertNotIn("systemctl:restart:phishtopia-ops-mcp-tunnel.service", fake.events)


if __name__ == "__main__":
    unittest.main()
