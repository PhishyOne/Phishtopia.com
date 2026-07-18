from __future__ import annotations

import base64
import hashlib
import hmac
import http.client
import ipaddress
import json
import os
import pwd
import re
import secrets
import selectors
import shutil
import signal
import socket
import ssl
import stat
import struct
import subprocess
import tarfile
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

from .allowlist import (
    BACKUP_BUCKET,
    CLOUD_RUN_SERVICE,
    DATABASE,
    DNS_A_TARGETS,
    DNS_CNAME_TARGETS,
    DNS_TOKEN_SECRET,
    PROJECT_ID,
    REGION,
    REPOSITORY,
    SESSION_SECRET,
)

STATE_ROOT = Path("/var/lib/phishtopia-ops-worker")
STAGING_ROOT = STATE_ROOT / "staging"
ROLLBACK_ROOT = STATE_ROOT / "rollback"
GCLOUD_CONFIG_ROOT = STATE_ROOT / "gcloud"
APP_LOG_ROOT = Path("/var/log/phishtopia")
APP_ERROR_LOG = APP_LOG_ROOT / "errors.log"
OPS_CURRENT = Path("/opt/phishtopia-ops-mcp")
OPS_RELEASES = Path("/opt/phishtopia-ops-releases")
OPS_NPM = Path("/opt/phishtopia-ops-runtime/node/bin/npm")
OPS_NODE = Path("/opt/phishtopia-ops-runtime/node/bin/node")
OPS_NPM_CLI = Path("/opt/phishtopia-ops-runtime/node/lib/node_modules/npm/bin/npm-cli.js")
APP_CURRENT = Path("/home/codespace/phishtopia")
APP_RELEASES = Path("/opt/phishtopia-app-releases")
RELEASE_MANIFEST = STATE_ROOT / "releases.json"
WORKER_REEXEC_FLAG = STATE_ROOT / "worker-reexec-requested"
WORKER_UNIT_PATH = Path("/etc/systemd/system/phishtopia-ops-worker.service")
TUNNEL_UNIT_PATH = Path("/etc/systemd/system/phishtopia-ops-mcp-tunnel.service")
TUNNEL_LAUNCHER_PATH = Path("/usr/local/libexec/phishtopia-ops-mcp-tunnel-launch")
PUBLIC_HEALTH = "https://phishtopia.com/health"
PUBLIC_ROOT = "https://phishtopia.com/"
OPS_UNIT = "phishtopia-ops-mcp-tunnel.service"
PM2_NAME = "phishtopia"
VM_SERVICE_ACCOUNT = "107649778409-compute@developer.gserviceaccount.com"
MIGRATION_TARGETS = frozenset({("public", "session", "expire")})
OPS_PYTHON_TEST_COMMAND = (
    "/usr/bin/python3",
    "-B",
    "-m",
    "unittest",
    "discover",
    "-s",
    "worker/test",
    "-p",
    "test_*.py",
)


class PlatformError(RuntimeError):
    pass


class Cancelled(PlatformError):
    pass


class DeadlineExceeded(PlatformError):
    pass


class WorkerHandoffRequested(PlatformError):
    pass


class FixedRedirectHandler(urllib.request.HTTPRedirectHandler):
    def __init__(self, allowed: frozenset[tuple[str, str]]):
        super().__init__()
        self.allowed = allowed

    def redirect_request(
        self,
        request: urllib.request.Request,
        file_pointer: Any,
        code: int,
        message: str,
        headers: Any,
        new_url: str,
    ) -> urllib.request.Request | None:
        source = urllib.parse.urlsplit(request.full_url)
        target = urllib.parse.urlsplit(new_url)
        if (
            target.scheme != "https"
            or target.username is not None
            or target.password is not None
            or target.port not in (None, 443)
            or (source.hostname or "", target.hostname or "") not in self.allowed
        ):
            raise PlatformError("redirect_not_allowlisted")
        return super().redirect_request(
            request, file_pointer, code, message, headers, new_url
        )


class CommandRunner:
    """Non-shell process runner. Callers provide only fixed executables and built arguments."""

    EXECUTABLES = frozenset(
        (
            "/usr/bin/gcloud",
            "/usr/bin/git",
            "/usr/bin/systemctl",
            "/usr/bin/systemd-run",
            "/usr/bin/setpriv",
            "/usr/bin/pg_dump",
            "/usr/bin/pg_restore",
            "/usr/bin/psql",
            "/usr/bin/createdb",
            "/usr/bin/dropdb",
            "/usr/bin/npm",
            "/usr/bin/node",
            "/usr/bin/pm2",
            "/usr/sbin/nginx",
            str(OPS_NPM),
            str(OPS_NODE),
        )
    )

    def run(
        self,
        command: list[str],
        *,
        timeout: int,
        cwd: Path | None = None,
        input_bytes: bytes | None = None,
        env: dict[str, str] | None = None,
        check: Callable[[], None] | None = None,
    ) -> bytes:
        if not command or command[0] not in self.EXECUTABLES:
            raise PlatformError("command_not_allowlisted")
        if any("\x00" in argument or "\n" in argument or "\r" in argument for argument in command):
            raise PlatformError("unsafe_command_argument")
        if input_bytes is not None and len(input_bytes) > 1_000_000:
            raise PlatformError("command_input_too_large")
        deadline = time.monotonic() + timeout
        input_file = tempfile.TemporaryFile() if input_bytes is not None else None
        try:
            if input_file is not None:
                input_file.write(input_bytes or b"")
                input_file.seek(0)
            process = subprocess.Popen(
                command,
                cwd=cwd,
                env=env or {
                    "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                    "HOME": "/root",
                    "NO_COLOR": "1",
                    "PYTHONDONTWRITEBYTECODE": "1",
                    "CLOUDSDK_CONFIG": str(GCLOUD_CONFIG_ROOT),
                    "CLOUDSDK_CORE_DISABLE_PROMPTS": "1",
                },
                stdin=input_file if input_file is not None else subprocess.DEVNULL,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                shell=False,
                close_fds=True,
                start_new_session=True,
            )
            assert process.stdout is not None
            os.set_blocking(process.stdout.fileno(), False)
            selector = selectors.DefaultSelector()
            selector.register(process.stdout, selectors.EVENT_READ)
            chunks: list[bytes] = []
            total = 0
            eof = False
            try:
                while not eof or process.poll() is None:
                    if check is not None:
                        check()
                    if time.monotonic() >= deadline:
                        raise PlatformError("command_timeout")
                    for key, _events in selector.select(timeout=0.5):
                        chunk = os.read(key.fd, 262_144)
                        if not chunk:
                            eof = True
                            selector.unregister(process.stdout)
                            break
                        total += len(chunk)
                        if total > 2_000_000:
                            raise PlatformError("command_output_too_large")
                        chunks.append(chunk)
                process.wait()
            except Exception:
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(5)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait()
                self._stop_transient_unit(command)
                raise
            finally:
                selector.close()
                process.stdout.close()
            stdout = b"".join(chunks)
        finally:
            if input_file is not None:
                input_file.close()
        if process.returncode != 0:
            raise PlatformError("command_failed")
        return stdout

    @staticmethod
    def _stop_transient_unit(command: list[str]) -> None:
        if not command or command[0] != "/usr/bin/systemd-run":
            return
        matches = [
            value.split("=", 1)[1]
            for value in command
            if value.startswith("--unit=")
        ]
        if len(matches) != 1 or re.fullmatch(
            r"phishtopia-build-[0-9a-f]{12}", matches[0]
        ) is None:
            return
        try:
            subprocess.run(
                ["/usr/bin/systemctl", "stop", matches[0]],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=30,
                env={
                    "PATH": "/usr/sbin:/usr/bin:/sbin:/bin",
                    "HOME": "/root",
                    "NO_COLOR": "1",
                },
            )
            active = subprocess.run(
                ["/usr/bin/systemctl", "is-active", "--quiet", matches[0]],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=10,
                env={
                    "PATH": "/usr/sbin:/usr/bin:/sbin:/bin",
                    "HOME": "/root",
                    "NO_COLOR": "1",
                },
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise PlatformError("transient_unit_stop_failed") from error
        if active.returncode == 0:
            raise PlatformError("transient_unit_still_active")

    def hash_run(
        self,
        command: list[str],
        *,
        timeout: int,
        check: Callable[[], None] | None = None,
    ) -> str:
        if not command or command[0] not in self.EXECUTABLES:
            raise PlatformError("command_not_allowlisted")
        if any("\x00" in argument or "\n" in argument or "\r" in argument for argument in command):
            raise PlatformError("unsafe_command_argument")
        process = subprocess.Popen(
            command,
            env={
                "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                "HOME": "/root",
                "NO_COLOR": "1",
                "CLOUDSDK_CONFIG": str(GCLOUD_CONFIG_ROOT),
                "CLOUDSDK_CORE_DISABLE_PROMPTS": "1",
            },
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            shell=False,
            close_fds=True,
            start_new_session=True,
        )
        assert process.stdout is not None
        os.set_blocking(process.stdout.fileno(), False)
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        digest = hashlib.sha256()
        total = 0
        deadline = time.monotonic() + timeout
        eof = False
        try:
            while not eof or process.poll() is None:
                if check is not None:
                    check()
                if time.monotonic() >= deadline:
                    raise PlatformError("command_timeout")
                for key, _events in selector.select(timeout=0.5):
                    chunk = os.read(key.fd, 1_048_576)
                    if not chunk:
                        eof = True
                        selector.unregister(process.stdout)
                        break
                    total += len(chunk)
                    if total > 4_000_000_000:
                        raise PlatformError("command_output_quota_exceeded")
                    digest.update(chunk)
            process.wait()
        except Exception:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(5)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            raise
        finally:
            selector.close()
            process.stdout.close()
        if process.returncode != 0:
            raise PlatformError("command_failed")
        return digest.hexdigest()


class RealPlatform:
    def __init__(self, runner: CommandRunner | None = None):
        self.runner = runner or CommandRunner()
        self._guard: Callable[[], None] | None = None
        for directory in (STATE_ROOT, STAGING_ROOT, ROLLBACK_ROOT, GCLOUD_CONFIG_ROOT):
            directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            os.chmod(directory, 0o700)
        self._clean_stale_staging()
        self._clean_current_env_temporaries()

    def bind_guard(self, guard: Callable[[], None] | None) -> None:
        self._guard = guard

    def runtime_preflight_contract(self) -> dict[str, str]:
        self._pm2_status()
        self._database_size_bytes()
        self._identity()
        described = self._gcloud(
            "compute",
            "instances",
            "describe",
            "phishtopia-vm",
            "--zone=us-east1-b",
            f"--project={PROJECT_ID}",
            "--format=value(name)",
            timeout=30,
        ).decode().strip()
        if described != "phishtopia-vm":
            raise PlatformError("fixed_vm_probe_failed")
        self._dns_scope_preflight()
        observed_uid = self._run(
            self._as_account(
                "phishtopia-mcp",
                [
                    "/usr/bin/env",
                    "HOME=/var/lib/phishtopia-ops-mcp",
                    "/usr/bin/id",
                    "-u",
                ],
            ),
            timeout=10,
        ).decode().strip()
        if observed_uid != str(pwd.getpwnam("phishtopia-mcp").pw_uid):
            raise PlatformError("privilege_drop_preflight_failed")
        return {
            "pm2": "passed",
            "postgres": "passed",
            "mcpUser": "passed",
            "gcloudIdentity": "passed",
            "dnsRollback": "passed",
        }

    def preflight(self, action: dict[str, Any], check: Callable[[], None]) -> None:
        check()
        if os.geteuid() != 0:
            raise PlatformError("worker_not_root")
        action_type = action["type"]
        database_size = (
            self._database_size_bytes()
            if action_type == "run_tested_migration"
            else 0
        )
        required_memory, required_disk = self._required_capacity(
            action_type, database_size
        )
        disk = shutil.disk_usage(STATE_ROOT)
        if disk.free < required_disk:
            raise PlatformError("insufficient_disk_capacity")
        memory_available = self._memory_available()
        if memory_available < required_memory:
            raise PlatformError("insufficient_memory_capacity")
        self._public_health(PUBLIC_HEALTH)
        self._identity()
        if action_type in ("upgrade_ops_release", "restart_phishtopia_service"):
            self._systemctl("is-active", OPS_UNIT, timeout=15)
        if action_type in ("deploy_verified_release", "rollback_release", "rotate_session_secret"):
            self._pm2_status()
        if action_type == "rotate_session_secret":
            self._assert_cloud_run_not_session_secret_consumer()
        if action_type == "canary_and_promote":
            self._cloud_run_service()
        if action_type == "run_tested_migration":
            self._database_fingerprint()
        if action_type in {"upgrade_ops_release", "deploy_verified_release"}:
            target = (
                "phishtopia_ops"
                if action_type == "upgrade_ops_release"
                else "phishtopia_app"
            )
            recorded = self._release_manifest().get(target, {})
            if action["commit"] not in recorded and len(recorded) >= 5:
                raise PlatformError("release_retention_capacity_reached")
        if action_type == "update_dns_with_rollback":
            self._dns_token()

    @staticmethod
    def _required_capacity(action_type: str, database_size: int = 0) -> tuple[int, int]:
        if action_type in {"upgrade_ops_release", "deploy_verified_release"}:
            return 640_000_000, 2_000_000_000
        if action_type == "run_tested_migration":
            if database_size < 0 or database_size > 100_000_000_000:
                raise PlatformError("database_size_invalid")
            return 384_000_000, 1_000_000_000 + 3 * database_size
        return 256_000_000, 1_000_000_000

    def capture(self, action: dict[str, Any], job_id: str) -> dict[str, Any]:
        action_type = action["type"]
        baseline: dict[str, Any] = {"action": action_type}
        if action_type in ("upgrade_ops_release",) or (
            action_type == "rollback_release" and action["target"] == "phishtopia_ops"
        ):
            baseline.update(
                {
                    "current": self._current_target(OPS_CURRENT),
                    "unit_active": self._systemctl("is-active", OPS_UNIT, timeout=15).decode().strip(),
                }
            )
        elif action_type in ("deploy_verified_release",) or (
            action_type == "rollback_release" and action["target"] == "phishtopia_app"
        ):
            commit = self._app_commit(APP_CURRENT)
            legacy = not APP_CURRENT.is_symlink()
            baseline.update(
                {
                    "current": str(APP_RELEASES / commit)
                    if legacy
                    else self._current_target(APP_CURRENT),
                    "commit": commit,
                    "legacy": legacy,
                    "pm2": self._pm2_status(),
                }
            )
        elif action_type == "restart_phishtopia_service":
            baseline["service"] = action["service"]
            baseline["pm2"] = self._pm2_status() if action["service"] == "phishtopia_app" else None
        elif action_type == "canary_and_promote":
            traffic = self._cloud_run_service().get("status", {}).get("traffic", [])
            self._validate_canary_baseline(traffic)
            baseline["traffic"] = traffic
        elif action_type == "run_tested_migration":
            baseline["database"] = self._database_fingerprint()
            baseline["backup_object"] = f"gs://{BACKUP_BUCKET}/postgres/ops/{job_id}.dump"
            spec = self._migration_spec(action)
            baseline["migration"] = spec
            baseline["rehearsal"] = "ops_rehearsal_" + job_id.replace("-", "")[:20]
            baseline["index_present"] = self._index_exists(DATABASE, spec)
            if baseline["index_present"]:
                raise PlatformError("migration_target_already_exists")
        elif action_type == "rotate_session_secret":
            baseline["versions"] = self._secret_versions()
            baseline["env_backup"] = str(ROLLBACK_ROOT / f"{job_id}.env")
        elif action_type == "update_dns_with_rollback":
            baseline["record"] = self._cloudflare_record(action)
        if action_type in {
            "upgrade_ops_release",
            "deploy_verified_release",
            "rollback_release",
        }:
            baseline["release_manifest"] = self._release_manifest()
        if action_type in {"upgrade_ops_release", "deploy_verified_release"}:
            release_root = (
                OPS_RELEASES
                if action_type == "upgrade_ops_release"
                else APP_RELEASES
            )
            destination = release_root / action["commit"]
            baseline["release_destination"] = str(destination)
            baseline["destination_preexisting"] = (
                destination.exists() or destination.is_symlink()
            )
        if action_type in {
            "upgrade_ops_release",
            "deploy_verified_release",
            "restart_phishtopia_service",
            "rollback_release",
            "canary_and_promote",
            "run_tested_migration",
            "rotate_session_secret",
            "update_dns_with_rollback",
        }:
            baseline["production_invariants"] = self._production_invariants()
        return baseline

    def perform(
        self,
        action: dict[str, Any],
        job_id: str,
        baseline: dict[str, Any],
        check: Callable[[], None],
        progress: Callable[[int, str], None],
        mutation: Callable[[], None],
    ) -> list[dict[str, str]]:
        action_type = action["type"]
        if action_type == "upgrade_ops_release":
            return self._upgrade_ops(action, baseline, check, progress, mutation)
        if action_type == "deploy_verified_release":
            return self._deploy_app(action, baseline, check, progress, mutation)
        if action_type == "restart_phishtopia_service":
            return self._restart(action, baseline, check, progress, mutation)
        if action_type == "rollback_release":
            return self._rollback_release(action, baseline, check, progress, mutation)
        if action_type == "canary_and_promote":
            return self._canary(action, baseline, check, progress, mutation)
        if action_type == "run_tested_migration":
            return self._migration(action, job_id, baseline, check, progress, mutation)
        if action_type == "rotate_session_secret":
            return self._rotate_secret(action, job_id, baseline, check, progress, mutation)
        return self._update_dns(action, baseline, check, progress, mutation)

    def rollback(self, action: dict[str, Any], baseline: dict[str, Any]) -> None:
        action_type = action["type"]
        if action_type in ("upgrade_ops_release",) or (
            action_type == "rollback_release" and action.get("target") == "phishtopia_ops"
        ):
            self._restore_target(OPS_CURRENT, baseline.get("current"))
            self._remove_new_release(action, baseline)
            self._restore_release_manifest(baseline.get("release_manifest"))
            self._systemctl("restart", OPS_UNIT, timeout=45)
            self._verify_ops()
        elif action_type in ("deploy_verified_release",) or (
            action_type == "rollback_release" and action.get("target") == "phishtopia_app"
        ):
            if baseline.get("legacy") is True:
                original = Path(str(baseline.get("current", "")))
                if APP_CURRENT.is_symlink():
                    APP_CURRENT.unlink()
                if not APP_CURRENT.exists():
                    if original.parent != APP_RELEASES or not original.is_dir():
                        raise PlatformError("legacy_rollback_target_missing")
                    os.rename(original, APP_CURRENT)
                    self._fsync_directories(original.parent, APP_CURRENT.parent)
                elif not APP_CURRENT.is_dir():
                    raise PlatformError("legacy_rollback_target_missing")
            else:
                self._restore_target(APP_CURRENT, baseline.get("current"))
            self._remove_new_release(action, baseline)
            self._restore_release_manifest(baseline.get("release_manifest"))
            self._pm2("reload", PM2_NAME, "--update-env", timeout=45)
            self._public_health(PUBLIC_HEALTH)
        elif action_type == "restart_phishtopia_service":
            if action["service"] == "phishtopia_app":
                self._pm2("reload", PM2_NAME, "--update-env", timeout=45)
                self._public_health(PUBLIC_HEALTH)
            else:
                self._systemctl("restart", OPS_UNIT, timeout=45)
                self._verify_ops()
        elif action_type == "canary_and_promote" and isinstance(baseline.get("traffic"), list):
            self._set_traffic(baseline["traffic"])
        elif action_type == "run_tested_migration":
            spec = baseline.get("migration")
            if not isinstance(spec, dict) or baseline.get("index_present") is not False:
                raise PlatformError("migration_rollback_baseline_invalid")
            rehearsal = baseline.get("rehearsal")
            if not isinstance(rehearsal, str):
                raise PlatformError("migration_rollback_baseline_invalid")
            self._validated_database(rehearsal)
            try:
                self._apply_index_change(DATABASE, spec, create=False)
                if self._database_fingerprint(DATABASE) != baseline.get("database"):
                    raise PlatformError("migration_rollback_verification_failed")
            finally:
                self._postgres("/usr/bin/dropdb", "--if-exists", rehearsal, timeout=60)
            backup_object = baseline.get("backup_object")
            if not isinstance(backup_object, str) or re.fullmatch(
                rf"gs://{re.escape(BACKUP_BUCKET)}/postgres/ops/"
                r"[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-"
                r"[89ab][0-9a-f]{3}-[0-9a-f]{12}\.dump",
                backup_object,
            ) is None:
                raise PlatformError("migration_backup_baseline_invalid")
            self._delete_backup_if_present(backup_object)
        elif action_type == "rotate_session_secret":
            previous_versions = {
                value for value in baseline.get("versions", []) if isinstance(value, str)
            }
            for old_version in previous_versions:
                self._gcloud(
                    "secrets", "versions", "enable", old_version,
                    "--secret", SESSION_SECRET, f"--project={PROJECT_ID}", "--quiet",
                    timeout=30,
                )
            backup = Path(str(baseline.get("env_backup", "")))
            if backup.parent == ROLLBACK_ROOT and backup.is_file():
                self._safe_env_write(APP_CURRENT, self._read_private_backup(backup))
                self._pm2("reload", PM2_NAME, "--update-env", timeout=45)
            for new_version in set(self._secret_versions()) - previous_versions:
                self._gcloud(
                    "secrets", "versions", "disable", new_version, "--secret", SESSION_SECRET,
                    f"--project={PROJECT_ID}", "--quiet", timeout=30
                )
            if backup.parent == ROLLBACK_ROOT:
                self._remove_private_backup(backup)
        elif action_type == "update_dns_with_rollback" and isinstance(baseline.get("record"), dict):
            self._cloudflare_restore(baseline["record"])
        if action_type in {
            "upgrade_ops_release",
            "deploy_verified_release",
            "restart_phishtopia_service",
            "rollback_release",
            "canary_and_promote",
            "run_tested_migration",
            "rotate_session_secret",
            "update_dns_with_rollback",
        }:
            self._verify_production_invariants(
                baseline, ignored=frozenset({"error_signal"})
            )
        if action_type in {"upgrade_ops_release", "rollback_release"} and (
            action_type == "upgrade_ops_release"
            or action.get("target") == "phishtopia_ops"
        ):
            self._request_worker_reexec()

    def _upgrade_ops(self, action: dict[str, Any], baseline: dict[str, Any], check: Callable[[], None], progress: Callable[[int, str], None], mutation: Callable[[], None] = lambda: None) -> list[dict[str, str]]:
        progress(15, "verified_commit")
        root = self._verified_archive(action["commit"], action["artifactSha256"], check)
        source = root / "ops" / "phishtopia-ops-mcp"
        if not (source / "package-lock.json").is_file():
            raise PlatformError("ops_source_missing")
        self._verify_immutable_unit_contract(source)
        progress(35, "artifact_verified")
        self._prepare_candidate(
            source,
            dependency_source=OPS_CURRENT / "node_modules",
            kind="ops",
        )
        tools_directory = source / ".tools"
        tools_directory.mkdir(mode=0o755, exist_ok=True)
        node_link = tools_directory / "node"
        node_link.unlink(missing_ok=True)
        node_link.symlink_to(OPS_NODE.parent.parent)
        check()
        progress(65, "candidate_tested")
        destination = OPS_RELEASES / action["commit"]
        if (
            baseline.get("destination_preexisting") is not False
            or baseline.get("release_destination") != str(destination)
        ):
            raise PlatformError("release_destination_exists")
        mutation()
        self._install_release(source, destination)
        self._switch_symlink(OPS_CURRENT, destination)
        self._systemctl("restart", OPS_UNIT, timeout=45)
        self._verify_ops()
        self._verify_production_invariants(baseline)
        self._record_release("phishtopia_ops", action["commit"], action["artifactSha256"])
        progress(95, "worker_handoff_pending")
        self._request_worker_reexec()
        raise WorkerHandoffRequested("worker_handoff_pending")

    def complete_ops_handoff(
        self, action: dict[str, Any], baseline: dict[str, Any], check: Callable[[], None]
    ) -> list[dict[str, str]]:
        action_type = action.get("type")
        if action_type not in {"upgrade_ops_release", "rollback_release"}:
            raise PlatformError("worker_handoff_action_invalid")
        if action_type == "rollback_release" and action.get("target") != "phishtopia_ops":
            raise PlatformError("worker_handoff_action_invalid")
        release = (
            action.get("commit")
            if action_type == "upgrade_ops_release"
            else action.get("release")
        )
        destination = OPS_RELEASES / str(release or "")
        if self._current_target(OPS_CURRENT) != str(destination.resolve(strict=True)):
            raise PlatformError("worker_handoff_target_mismatch")
        self._verify_immutable_unit_contract(destination)
        check()
        self._verify_ops()
        self._verify_production_invariants(baseline)
        return self._observations(
            ("release", str(release)[:12]),
            ("tool_contract", "passed"),
            ("root_worker", "reexec_verified"),
            ("tunnel", "ready"),
        )

    @staticmethod
    def _verify_immutable_unit_contract(source: Path) -> None:
        pairs = (
            (source / "systemd" / "phishtopia-ops-worker.service", WORKER_UNIT_PATH),
            (source / "systemd" / "phishtopia-ops-mcp-tunnel.service", TUNNEL_UNIT_PATH),
            (source / "systemd" / "phishtopia-ops-mcp-tunnel-launch", TUNNEL_LAUNCHER_PATH),
        )
        for candidate, installed in pairs:
            try:
                if candidate.read_bytes() != installed.read_bytes():
                    raise PlatformError("immutable_unit_contract_changed")
            except OSError as error:
                raise PlatformError("immutable_unit_contract_unavailable") from error

    @staticmethod
    def _request_worker_reexec() -> None:
        temporary = STATE_ROOT / "worker-reexec-requested.next"
        temporary.unlink(missing_ok=True)
        descriptor = os.open(
            temporary,
            os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        try:
            os.write(descriptor, b"reexec\n")
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.replace(temporary, WORKER_REEXEC_FLAG)
        RealPlatform._fsync_directories(STATE_ROOT)

    def _deploy_app(self, action: dict[str, Any], baseline: dict[str, Any], check: Callable[[], None], progress: Callable[[int, str], None], mutation: Callable[[], None] = lambda: None) -> list[dict[str, str]]:
        progress(15, "verified_commit")
        root = self._verified_archive(action["commit"], action["artifactSha256"], check)
        self._prepare_candidate(
            root,
            dependency_source=APP_CURRENT / "node_modules",
            kind="app",
        )
        check()
        progress(55, "candidate_tested")
        destination = APP_RELEASES / action["commit"]
        if (
            baseline.get("destination_preexisting") is not False
            or baseline.get("release_destination") != str(destination)
        ):
            raise PlatformError("release_destination_exists")
        mutation()
        env_bytes = self._safe_env_read()
        self._safe_env_write(root, env_bytes)
        self._install_release(root, destination)
        if not APP_CURRENT.is_symlink():
            old_commit = self._app_commit(APP_CURRENT)
            legacy_destination = APP_RELEASES / old_commit
            if legacy_destination.exists():
                raise PlatformError("legacy_release_target_exists")
            os.rename(APP_CURRENT, legacy_destination)
            self._fsync_directories(APP_CURRENT.parent, legacy_destination.parent)
            self._record_release("phishtopia_app", old_commit, "legacy-baseline")
        self._switch_symlink(APP_CURRENT, destination)
        self._pm2("reload", PM2_NAME, "--update-env", timeout=45)
        self._public_health(PUBLIC_HEALTH)
        self._public_health(PUBLIC_ROOT)
        self._verify_session_cookie()
        self._verify_production_invariants(baseline)
        self._record_release("phishtopia_app", action["commit"], action["artifactSha256"])
        progress(95, "application_verified")
        return self._observations(("release", action["commit"][:12]), ("tests", "passed"), ("public_health", "passed"))

    def _restart(self, action: dict[str, Any], baseline: dict[str, Any], check: Callable[[], None], progress: Callable[[int, str], None], mutation: Callable[[], None] = lambda: None) -> list[dict[str, str]]:
        check()
        mutation()
        if action["service"] == "phishtopia_app":
            self._pm2("reload", PM2_NAME, "--update-env", timeout=45)
            self._public_health(PUBLIC_HEALTH)
        else:
            self._systemctl("restart", OPS_UNIT, timeout=45)
            self._verify_ops()
        self._verify_production_invariants(baseline)
        progress(95, "service_verified")
        return self._observations(("service", action["service"]), ("health", "passed"))

    def _rollback_release(self, action: dict[str, Any], baseline: dict[str, Any], check: Callable[[], None], progress: Callable[[int, str], None], mutation: Callable[[], None] = lambda: None) -> list[dict[str, str]]:
        manifest = self._release_manifest()
        key = action["target"]
        record = manifest.get(key, {}).get(action["release"])
        if not isinstance(record, dict):
            raise PlatformError("release_not_recorded")
        root = APP_RELEASES if key == "phishtopia_app" else OPS_RELEASES
        target = root / action["release"]
        if not target.is_dir():
            raise PlatformError("release_missing")
        if (
            set(record) != {"sha256", "treeSha256"}
            or not isinstance(record.get("treeSha256"), str)
            or self._tree_digest(target) != record["treeSha256"]
        ):
            raise PlatformError("release_integrity_failed")
        check()
        progress(55, "rollback_target_verified")
        mutation()
        if key == "phishtopia_app":
            self._safe_env_write(target, self._safe_env_read())
            self._switch_symlink(APP_CURRENT, target)
            self._pm2("reload", PM2_NAME, "--update-env", timeout=45)
            self._public_health(PUBLIC_HEALTH)
        else:
            self._switch_symlink(OPS_CURRENT, target)
            self._systemctl("restart", OPS_UNIT, timeout=45)
            self._verify_ops()
        self._verify_production_invariants(baseline)
        if key == "phishtopia_ops":
            progress(95, "worker_handoff_pending")
            self._request_worker_reexec()
            raise WorkerHandoffRequested("worker_handoff_pending")
        progress(95, "rollback_verified")
        return self._observations(("target", key), ("release", action["release"][:12]), ("health", "passed"))

    def _canary(self, action: dict[str, Any], baseline: dict[str, Any], check: Callable[[], None], progress: Callable[[int, str], None], mutation: Callable[[], None] = lambda: None) -> list[dict[str, str]]:
        service = self._cloud_run_service()
        if service.get("status", {}).get("latestReadyRevisionName") != action["revision"]:
            raise PlatformError("revision_not_latest_ready")
        revisions = self._gcloud_json(
            "run", "revisions", "list", f"--service={CLOUD_RUN_SERVICE}", f"--region={REGION}",
            f"--project={PROJECT_ID}", "--format=json", timeout=30
        )
        if not isinstance(revisions, list) or action["revision"] not in {item.get("metadata", {}).get("name") for item in revisions if isinstance(item, dict)}:
            raise PlatformError("revision_not_found")
        traffic = service.get("status", {}).get("traffic", [])
        self._validate_canary_baseline(traffic)
        baseline_revision = traffic[0]["revisionName"]
        if self._revision_error_count(action["revision"]) != 0:
            raise PlatformError("candidate_has_recent_errors")
        mutation()
        self._gcloud(
            "run", "services", "update-traffic", CLOUD_RUN_SERVICE,
            f"--region={REGION}", f"--project={PROJECT_ID}",
            f"--set-tags=ops-canary={action['revision']}", "--quiet", timeout=120,
        )
        tagged_service = self._cloud_run_service()
        candidate_url = self._canary_tag_url(tagged_service, action["revision"])
        self._cloud_run_health_url(candidate_url)
        for index, percentage in enumerate(action["percentages"]):
            check()
            mapping = f"{action['revision']}={percentage}"
            if percentage < 100:
                mapping += f",{baseline_revision}={100 - percentage}"
            self._gcloud(
                "run", "services", "update-traffic", CLOUD_RUN_SERVICE, f"--region={REGION}",
                f"--project={PROJECT_ID}", f"--to-revisions={mapping}", "--quiet", timeout=120
            )
            current = self._cloud_run_service()
            expected = {action["revision"]: percentage}
            if percentage < 100:
                expected[baseline_revision] = 100 - percentage
            if self._traffic_percentages(current) != expected:
                raise PlatformError("cloud_run_traffic_mismatch")
            if not self._revision_ready(action["revision"], revisions):
                raise PlatformError("cloud_run_not_ready")
            self._cloud_run_health_url(candidate_url)
            self._pause(60)
            if self._revision_error_count(action["revision"]) != 0:
                raise PlatformError("canary_error_gate_failed")
            self._cloud_run_health_url(candidate_url)
            progress(20 + int(70 * (index + 1) / len(action["percentages"])), "canary_gate_passed")
        self._gcloud(
            "run", "services", "update-traffic", CLOUD_RUN_SERVICE,
            f"--region={REGION}", f"--project={PROJECT_ID}",
            "--remove-tags=ops-canary", "--quiet", timeout=120,
        )
        if self._traffic_percentages(self._cloud_run_service()) != {
            action["revision"]: 100
        }:
            raise PlatformError("cloud_run_promotion_incomplete")
        self._verify_production_invariants(
            baseline, ignored=frozenset({"cloud_run_traffic"})
        )
        return self._observations(("revision", action["revision"]), ("traffic_percent", "100"), ("monitoring_gates", "passed"))

    def _migration(
        self,
        action: dict[str, Any],
        job_id: str,
        baseline: dict[str, Any],
        check: Callable[[], None],
        progress: Callable[[int, str], None],
        mutation: Callable[[], None] = lambda: None,
    ) -> list[dict[str, str]]:
        spec = baseline.get("migration")
        if not isinstance(spec, dict) or spec != self._migration_spec(action):
            raise PlatformError("migration_spec_changed")
        if baseline.get("index_present") is not False:
            raise PlatformError("migration_target_already_exists")
        progress(20, "migration_verified")
        mutation()
        stage = Path("/tmp") / f"phishtopia-ops-migration-{job_id}"
        if stage.exists() or stage.is_symlink():
            raise PlatformError("migration_stage_exists")
        account = pwd.getpwnam("postgres")
        stage.mkdir(mode=0o700)
        os.chown(stage, account.pw_uid, account.pw_gid)
        dump = stage / "backup.dump"
        rehearsal = baseline.get("rehearsal")
        if not isinstance(rehearsal, str):
            raise PlatformError("migration_rehearsal_baseline_missing")
        self._validated_database(rehearsal)
        try:
            self._postgres(
                "/usr/bin/pg_dump", "-Fc", "-d", DATABASE, "-f", str(dump),
                timeout=600,
            )
            self._gcloud(
                "storage", "cp", str(dump), baseline["backup_object"],
                f"--project={PROJECT_ID}", timeout=600,
            )
            described = self._gcloud_json(
                "storage", "objects", "describe", baseline["backup_object"],
                f"--project={PROJECT_ID}", "--format=json", timeout=60,
            )
            dump_details = dump.stat(follow_symlinks=False)
            if (
                not isinstance(described, dict)
                or not stat.S_ISREG(dump_details.st_mode)
                or dump_details.st_uid != account.pw_uid
                or dump_details.st_mode & 0o077
                or dump_details.st_size <= 0
                or int(described.get("size", 0)) != dump_details.st_size
                or not isinstance(described.get("crc32c"), str)
            ):
                raise PlatformError("off_vm_backup_unverified")
            progress(45, "backup_verified")
            self._postgres("/usr/bin/createdb", rehearsal, timeout=60)
            self._postgres(
                "/usr/bin/pg_restore", "-d", rehearsal, str(dump), timeout=600
            )
            restored = self._database_fingerprint(rehearsal)
            if restored != baseline.get("database") or self._index_exists(rehearsal, spec):
                raise PlatformError("restore_rehearsal_baseline_mismatch")
            self._apply_index_change(rehearsal, spec, create=True)
            if not self._index_exists(rehearsal, spec):
                raise PlatformError("restore_rehearsal_up_failed")
            rehearsal_up = self._database_fingerprint(rehearsal)
            if (
                rehearsal_up["data"] != restored["data"]
                or rehearsal_up["schema"] == restored["schema"]
            ):
                raise PlatformError("migration_changed_data")
            self._apply_index_change(rehearsal, spec, create=False)
            if self._database_fingerprint(rehearsal) != restored:
                raise PlatformError("restore_rehearsal_inverse_mismatch")
            check()
            progress(70, "restore_rehearsal_passed")
            if self._database_fingerprint(DATABASE) != baseline.get("database"):
                raise PlatformError("database_changed_since_baseline")
            self._apply_index_change(DATABASE, spec, create=True)
            if not self._index_exists(DATABASE, spec):
                raise PlatformError("migration_apply_failed")
            current = self._database_fingerprint(DATABASE)
            expected = baseline.get("database")
            if (
                not isinstance(expected, dict)
                or current["data"] != expected.get("data")
                or current["schema"] != rehearsal_up["schema"]
            ):
                raise PlatformError("migration_changed_data")
            self._public_health(PUBLIC_HEALTH)
            self._verify_production_invariants(
                baseline, ignored=frozenset({"database_schema"})
            )
            check()
            progress(95, "migration_verified")
            return self._observations(
                ("migration", action["migrationId"]),
                ("backup", "verified_off_vm"),
                ("restore_rehearsal", "up_down_exact"),
            )
        finally:
            try:
                self._postgres("/usr/bin/dropdb", "--if-exists", rehearsal, timeout=60)
            finally:
                shutil.rmtree(stage, ignore_errors=True)

    def _rotate_secret(self, action: dict[str, Any], job_id: str, baseline: dict[str, Any], check: Callable[[], None], progress: Callable[[int, str], None], mutation: Callable[[], None] = lambda: None) -> list[dict[str, str]]:
        if action["secret"] != SESSION_SECRET:
            raise PlatformError("session_secret_preflight_failed")
        current_env = self._safe_env_read()
        backup = ROLLBACK_ROOT / f"{job_id}.env"
        if baseline.get("env_backup") != str(backup):
            raise PlatformError("secret_backup_baseline_invalid")
        mutation()
        self._write_private_backup(backup, current_env)
        generated = secrets.token_urlsafe(48)
        output = self._gcloud(
            "secrets", "versions", "add", SESSION_SECRET, f"--project={PROJECT_ID}", "--data-file=-", "--format=value(name)",
            timeout=60, input_bytes=generated.encode()
        ).decode().strip()
        match = re.search(r"/versions/([0-9]+)$", output)
        if match is None:
            raise PlatformError("secret_version_unconfirmed")
        progress(45, "secret_version_created")
        self._safe_env_write(
            APP_CURRENT,
            self._replace_env_value(current_env, "SESSION_SECRET", generated),
        )
        check()
        self._pm2("reload", PM2_NAME, "--update-env", timeout=45)
        self._public_health(PUBLIC_HEALTH)
        self._pm2_status()
        self._verify_session_cookie(expected_session_secret=generated)
        self._verify_production_invariants(
            baseline, ignored=frozenset({"app_env"})
        )
        previous_versions = [
            value for value in baseline.get("versions", []) if isinstance(value, str)
        ]
        for old_version in previous_versions:
            self._gcloud(
                "secrets", "versions", "disable", old_version,
                "--secret", SESSION_SECRET, f"--project={PROJECT_ID}", "--quiet",
                timeout=30,
            )
        generated = ""
        check()
        progress(95, "secret_consumers_verified")
        return self._observations(("secret", SESSION_SECRET), ("new_version", match.group(1)), ("consumers", "validated"))

    def cleanup(self, action: dict[str, Any], baseline: dict[str, Any]) -> None:
        if action.get("type") != "rotate_session_secret":
            return
        backup = Path(str(baseline.get("env_backup", "")))
        self._remove_private_backup(backup)

    def cleanup_staging(self, action: dict[str, Any]) -> None:
        commit = action.get("commit")
        if not isinstance(commit, str) or re.fullmatch(r"[0-9a-f]{40}", commit) is None:
            return
        CommandRunner._stop_transient_unit(
            ["/usr/bin/systemd-run", f"--unit=phishtopia-build-{commit[:12]}"]
        )
        (STAGING_ROOT / f"{commit}.tar.gz").unlink(missing_ok=True)
        shutil.rmtree(STAGING_ROOT / f"extract-{commit}", ignore_errors=True)

    @staticmethod
    def _clean_stale_staging() -> None:
        for path in STAGING_ROOT.iterdir():
            if path.is_file() and re.fullmatch(r"[0-9a-f]{40}\.tar\.gz", path.name):
                CommandRunner._stop_transient_unit(
                    [
                        "/usr/bin/systemd-run",
                        f"--unit=phishtopia-build-{path.name[:12]}",
                    ]
                )
                path.unlink()
            elif path.is_dir() and re.fullmatch(r"extract-[0-9a-f]{40}", path.name):
                CommandRunner._stop_transient_unit(
                    [
                        "/usr/bin/systemd-run",
                        f"--unit=phishtopia-build-{path.name[8:20]}",
                    ]
                )
                shutil.rmtree(path)

    def _update_dns(self, action: dict[str, Any], baseline: dict[str, Any], check: Callable[[], None], progress: Callable[[int, str], None], mutation: Callable[[], None] = lambda: None) -> list[dict[str, str]]:
        token = self._dns_token()
        zone, record, nameservers = self._cloudflare_zone_and_record(action, token)
        record_id = record.get("id")
        if not isinstance(record_id, str) or not re.fullmatch(r"[0-9a-f]{32}", record_id):
            raise PlatformError("dns_record_id_invalid")
        if baseline.get("record") != {"zone": zone, "record": record}:
            raise PlatformError("dns_baseline_changed")
        mutation()
        payload = {
            "type": action["recordType"], "name": action["hostname"], "content": action["value"],
            "ttl": action["ttl"], "proxied": False,
        }
        self._cloudflare_request(f"zones/{zone}/dns_records/{record_id}", token, method="PUT", payload=payload)
        token = ""
        progress(45, "dns_change_submitted")
        check()
        self._wait_dns(action, nameservers)
        progress(80, "dns_converged")
        self._public_hostname_health(action["hostname"])
        self._verify_tls()
        self._verify_production_invariants(
            baseline, ignored=frozenset({"dns"})
        )
        progress(95, "dns_application_verified")
        return self._observations(("hostname", action["hostname"]), ("record_type", action["recordType"]), ("dns_only", "true"), ("convergence", "passed"))

    def _verified_archive(self, commit: str, expected_digest: str, check: Callable[[], None]) -> Path:
        check_runs = self._github_json(f"commits/{commit}/check-runs?per_page=100")
        runs = check_runs.get("check_runs", []) if isinstance(check_runs, dict) else []
        if not isinstance(runs, list) or not runs:
            raise PlatformError("required_checks_missing")
        required = {
            "test",
            "Ops security and fake integration tests",
            "Secret scan",
        }
        passing = {
            str(item.get("name"))
            for item in runs
            if isinstance(item, dict)
            and item.get("status") == "completed"
            and item.get("conclusion") == "success"
            and item.get("head_sha") == commit
        }
        if not required <= passing:
            raise PlatformError("required_checks_not_passing")
        comparison = self._github_json(f"compare/{commit}...main")
        if not isinstance(comparison, dict) or comparison.get("status") not in {"ahead", "identical"}:
            raise PlatformError("commit_not_on_main")
        archive = STAGING_ROOT / f"{commit}.tar.gz"
        request = urllib.request.Request(
            f"https://api.github.com/repos/{REPOSITORY}/tarball/{commit}",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "phishtopia-ops-worker/1"},
        )
        digest = hashlib.sha256()
        total = 0
        with self._urlopen(
            request,
            timeout=30,
            redirects=frozenset({("api.github.com", "codeload.github.com")}),
        ) as response, archive.open("wb") as handle:
            while chunk := response.read(1_048_576):
                check()
                total += len(chunk)
                if total > 600_000_000:
                    raise PlatformError("artifact_too_large")
                digest.update(chunk)
                handle.write(chunk)
            handle.flush()
            os.fsync(handle.fileno())
        if digest.hexdigest() != expected_digest:
            archive.unlink(missing_ok=True)
            raise PlatformError("artifact_digest_mismatch")
        destination = STAGING_ROOT / f"extract-{commit}"
        if destination.exists():
            shutil.rmtree(destination)
        destination.mkdir(mode=0o755)
        try:
            with tarfile.open(archive, "r:gz") as bundle:
                members = bundle.getmembers()
                if len(members) > 30_000:
                    raise PlatformError("artifact_file_count_exceeded")
                uncompressed = 0
                for member in members:
                    parts = Path(member.name).parts
                    if member.isdev() or member.issym() or member.islnk() or not parts or ".." in parts:
                        raise PlatformError("unsafe_artifact_entry")
                    if member.size > 100_000_000:
                        raise PlatformError("artifact_entry_too_large")
                    uncompressed += member.size
                    if uncompressed > 750_000_000:
                        raise PlatformError("artifact_uncompressed_size_exceeded")
                if shutil.disk_usage(STAGING_ROOT).free < uncompressed + 1_000_000_000:
                    raise PlatformError("artifact_disk_reserve_insufficient")
                bundle.extractall(destination, filter="data")
        except Exception:
            shutil.rmtree(destination, ignore_errors=True)
            archive.unlink(missing_ok=True)
            raise
        roots = [path for path in destination.iterdir() if path.is_dir()]
        if len(roots) != 1:
            raise PlatformError("invalid_artifact_root")
        return roots[0]

    def _migration_spec(self, action: dict[str, Any]) -> dict[str, str]:
        root = self._verified_archive(
            action["commit"],
            action["artifactSha256"],
            self._guard or (lambda: None),
        )
        migration_root = root / "ops" / "migrations"
        try:
            manifest = json.loads(
                (migration_root / "manifest.json").read_text(encoding="utf8")
            )
        except (OSError, json.JSONDecodeError) as error:
            raise PlatformError("migration_manifest_invalid") from error
        entry = manifest.get(action["migrationId"]) if isinstance(manifest, dict) else None
        if not isinstance(entry, dict) or set(entry) != {"file", "sha256"}:
            raise PlatformError("migration_not_allowlisted")
        filename = f"{action['migrationId']}.json"
        if entry.get("file") != filename or re.fullmatch(
            r"[0-9a-f]{64}", str(entry.get("sha256", ""))
        ) is None:
            raise PlatformError("migration_manifest_invalid")
        source = migration_root / filename
        try:
            data = source.read_bytes()
            spec = json.loads(data)
        except (OSError, json.JSONDecodeError) as error:
            raise PlatformError("migration_spec_invalid") from error
        if hashlib.sha256(data).hexdigest() != entry["sha256"]:
            raise PlatformError("migration_digest_mismatch")
        if not isinstance(spec, dict) or set(spec) != {
            "operation",
            "schema",
            "table",
            "column",
            "index",
        }:
            raise PlatformError("migration_spec_invalid")
        target = (spec.get("schema"), spec.get("table"), spec.get("column"))
        expected_index = (
            "ops_"
            + action["migrationId"][:14]
            + "_"
            + hashlib.sha256(action["migrationId"].encode()).hexdigest()[:12]
            + "_idx"
        )
        if (
            spec.get("operation") != "create_index"
            or target not in MIGRATION_TARGETS
            or spec.get("index") != expected_index
        ):
            raise PlatformError("migration_target_not_allowlisted")
        return {key: str(spec[key]) for key in sorted(spec)}

    def _delete_backup_if_present(self, backup_object: str) -> None:
        prefix = f"gs://{BACKUP_BUCKET}/"
        if not backup_object.startswith(prefix):
            raise PlatformError("migration_backup_baseline_invalid")
        object_name = backup_object.removeprefix(prefix)
        if re.fullmatch(
            r"postgres/ops/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-"
            r"[89ab][0-9a-f]{3}-[0-9a-f]{12}\.dump",
            object_name,
        ) is None:
            raise PlatformError("migration_backup_baseline_invalid")
        objects = self._gcloud_json(
            "storage",
            "objects",
            "list",
            f"gs://{BACKUP_BUCKET}",
            f"--filter=name={object_name}",
            "--limit=2",
            "--format=json(name,generation)",
            f"--project={PROJECT_ID}",
            timeout=60,
        )
        if objects == []:
            return
        if not isinstance(objects, list) or len(objects) != 1 or not isinstance(objects[0], dict):
            raise PlatformError("migration_backup_metadata_invalid")
        name = str(objects[0].get("name", ""))
        generation = str(objects[0].get("generation", ""))
        if name not in {object_name, backup_object} or re.fullmatch(r"[0-9]{1,30}", generation) is None:
            raise PlatformError("migration_backup_metadata_invalid")
        self._gcloud(
            "storage",
            "rm",
            backup_object,
            f"--if-generation-match={generation}",
            f"--project={PROJECT_ID}",
            "--quiet",
            timeout=60,
        )

    def _github_json(self, path: str) -> Any:
        if not re.fullmatch(r"(?:commits/[0-9a-f]{40}/check-runs\?per_page=100|compare/[0-9a-f]{40}\.\.\.main)", path):
            raise PlatformError("github_path_not_allowlisted")
        request = urllib.request.Request(
            f"https://api.github.com/repos/{REPOSITORY}/{path}",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "phishtopia-ops-worker/1"},
        )
        with self._urlopen(request, timeout=20) as response:
            data = response.read(2_000_001)
        if len(data) > 2_000_000:
            raise PlatformError("github_response_too_large")
        return json.loads(data)

    def _cloud_run_service(self) -> dict[str, Any]:
        value = self._gcloud_json(
            "run", "services", "describe", CLOUD_RUN_SERVICE, f"--region={REGION}",
            f"--project={PROJECT_ID}", "--format=json", timeout=30
        )
        if not isinstance(value, dict):
            raise PlatformError("invalid_cloud_run_response")
        return value

    def _assert_cloud_run_not_session_secret_consumer(self) -> None:
        service = self._cloud_run_service()
        containers = (
            service.get("spec", {})
            .get("template", {})
            .get("spec", {})
            .get("containers")
        )
        if not isinstance(containers, list) or not containers:
            raise PlatformError("cloud_run_consumer_metadata_unavailable")
        for container in containers:
            if not isinstance(container, dict):
                raise PlatformError("cloud_run_consumer_metadata_unavailable")
            environment = container.get("env", [])
            if not isinstance(environment, list):
                raise PlatformError("cloud_run_consumer_metadata_unavailable")
            for item in environment:
                if not isinstance(item, dict):
                    raise PlatformError("cloud_run_consumer_metadata_unavailable")
                if item.get("name") == "SESSION_SECRET":
                    raise PlatformError("cloud_run_session_secret_consumer_unsupported")

    def _revision_error_count(self, revision: str) -> int:
        if not re.fullmatch(r"phishtopia-[0-9]{5}-[a-z0-9]{3}", revision):
            raise PlatformError("revision_not_allowlisted")
        value = self._gcloud_json(
            "logging",
            "read",
            (
                'resource.type="cloud_run_revision" AND '
                f'resource.labels.service_name="{CLOUD_RUN_SERVICE}" AND '
                f'resource.labels.revision_name="{revision}" AND severity>=ERROR'
            ),
            "--freshness=5m",
            "--limit=50",
            f"--project={PROJECT_ID}",
            "--format=json",
            timeout=30,
        )
        if not isinstance(value, list):
            raise PlatformError("invalid_logging_response")
        return len(value)

    @staticmethod
    def _traffic_percentages(service: dict[str, Any]) -> dict[str, int]:
        traffic = service.get("status", {}).get("traffic")
        if not isinstance(traffic, list):
            raise PlatformError("invalid_cloud_run_traffic")
        result: dict[str, int] = {}
        for item in traffic:
            if not isinstance(item, dict):
                raise PlatformError("invalid_cloud_run_traffic")
            revision, percentage = item.get("revisionName"), item.get("percent")
            if (
                not isinstance(revision, str)
                or re.fullmatch(r"phishtopia-[0-9]{5}-[a-z0-9]{3}", revision) is None
                or type(percentage) is not int
                or not 0 <= percentage <= 100
            ):
                raise PlatformError("invalid_cloud_run_traffic")
            if percentage == 0 and item.get("tag") == "ops-canary":
                continue
            result[revision] = result.get(revision, 0) + percentage
        if sum(result.values()) != 100:
            raise PlatformError("invalid_cloud_run_traffic")
        return result

    @staticmethod
    def _revision_ready(revision: str, revisions: Any) -> bool:
        if not isinstance(revisions, list):
            return False
        for item in revisions:
            if not isinstance(item, dict) or item.get("metadata", {}).get("name") != revision:
                continue
            conditions = item.get("status", {}).get("conditions", [])
            return any(
                isinstance(condition, dict)
                and condition.get("type") == "Ready"
                and condition.get("status") == "True"
                for condition in conditions
            )
        return False

    @staticmethod
    def _canary_tag_url(service: dict[str, Any], revision: str) -> str:
        traffic = service.get("status", {}).get("traffic", [])
        matches = [
            item.get("url")
            for item in traffic
            if isinstance(item, dict)
            and item.get("tag") == "ops-canary"
            and item.get("revisionName") == revision
            and isinstance(item.get("url"), str)
        ]
        if len(matches) != 1:
            raise PlatformError("canary_tag_url_unavailable")
        return matches[0]

    def _cloud_run_health_url(self, value: str) -> None:
        parsed = urllib.parse.urlsplit(value)
        hostname = parsed.hostname or ""
        if (
            parsed.scheme != "https"
            or parsed.username is not None
            or parsed.password is not None
            or parsed.port not in (None, 443)
            or not (
                hostname.startswith("phishtopia-")
                or hostname.startswith("ops-canary---phishtopia-")
            )
            or not hostname.endswith(".run.app")
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
        ):
            raise PlatformError("cloud_run_url_not_allowlisted")
        request = urllib.request.Request(
            value.rstrip("/") + "/health",
            headers={"User-Agent": "phishtopia-ops-worker/1"},
        )
        with self._urlopen(request, timeout=10) as response:
            if response.status != 200:
                raise PlatformError("cloud_run_health_failed")

    def _set_traffic(self, traffic: list[dict[str, Any]]) -> None:
        self._validate_canary_baseline(traffic)
        mapping: list[str] = []
        total = 0
        for item in traffic:
            revision, percent = item.get("revisionName"), item.get("percent")
            if not isinstance(revision, str) or not re.fullmatch(r"phishtopia-[0-9]{5}-[a-z0-9]{3}", revision) or type(percent) is not int:
                raise PlatformError("invalid_traffic_baseline")
            mapping.append(f"{revision}={percent}")
            total += percent
        if total != 100 or not mapping:
            raise PlatformError("invalid_traffic_baseline")
        self._gcloud(
            "run", "services", "update-traffic", CLOUD_RUN_SERVICE, f"--region={REGION}",
            f"--project={PROJECT_ID}", "--clear-tags",
            f"--to-revisions={','.join(mapping)}", "--quiet", timeout=120
        )

    @staticmethod
    def _validate_canary_baseline(value: Any) -> None:
        if not isinstance(value, list) or len(value) != 1:
            raise PlatformError("unsupported_traffic_baseline")
        item = value[0]
        if (
            not isinstance(item, dict)
            or set(item) != {"revisionName", "percent"}
            or not isinstance(item.get("revisionName"), str)
            or re.fullmatch(
                r"phishtopia-[0-9]{5}-[a-z0-9]{3}", item["revisionName"]
            )
            is None
            or item.get("percent") != 100
            or type(item.get("percent")) is not int
        ):
            raise PlatformError("unsupported_traffic_baseline")

    @staticmethod
    def _validated_database(database: str) -> str:
        if database == DATABASE or re.fullmatch(r"ops_rehearsal_[0-9a-f]{20}", database):
            return database
        raise PlatformError("database_not_allowlisted")

    def _database_fingerprint(self, database: str = DATABASE) -> dict[str, str]:
        database = self._validated_database(database)
        return {
            "schema": self._postgres_hash(
                "/usr/bin/pg_dump", "--schema-only", "--no-owner", "--no-privileges",
                "--restrict-key=PhishtopiaOpsFingerprint1",
                "-d", database, timeout=180,
            ),
            "data": self._postgres_hash(
                "/usr/bin/pg_dump", "--data-only", "--no-owner", "--no-privileges",
                "--restrict-key=PhishtopiaOpsFingerprint1",
                "-d", database, timeout=300,
            ),
        }

    def _database_size_bytes(self) -> int:
        value = self._postgres(
            "/usr/bin/psql",
            "-X",
            "--no-psqlrc",
            "-At",
            "-d",
            DATABASE,
            "-c",
            "SELECT pg_database_size(current_database());",
            timeout=30,
        ).decode().strip()
        if re.fullmatch(r"[0-9]{1,12}", value) is None:
            raise PlatformError("database_size_invalid")
        return int(value)

    @staticmethod
    def _index_sql(spec: dict[str, str], *, create: bool) -> str:
        if (
            set(spec) != {"column", "index", "operation", "schema", "table"}
            or spec.get("operation") != "create_index"
            or (spec.get("schema"), spec.get("table"), spec.get("column"))
            not in MIGRATION_TARGETS
            or re.fullmatch(r"ops_[0-9]{14}_[0-9a-f]{12}_idx", spec.get("index", ""))
            is None
        ):
            raise PlatformError("migration_spec_invalid")
        if create:
            return (
                f'CREATE INDEX "{spec["index"]}" ON '
                f'"{spec["schema"]}"."{spec["table"]}" ("{spec["column"]}");'
            )
        return f'DROP INDEX IF EXISTS "{spec["schema"]}"."{spec["index"]}";'

    def _index_exists(self, database: str, spec: dict[str, str]) -> bool:
        database = self._validated_database(database)
        self._index_sql(spec, create=True)
        query = (
            "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='"
            + spec["index"]
            + "' LIMIT 1;"
        )
        output = self._postgres(
            "/usr/bin/psql", "-X", "--no-psqlrc", "-At", "-d", database,
            "-c", query, timeout=30,
        ).decode().strip()
        if output not in {"", "1"}:
            raise PlatformError("migration_metadata_invalid")
        return output == "1"

    def _apply_index_change(
        self, database: str, spec: dict[str, str], *, create: bool
    ) -> None:
        database = self._validated_database(database)
        sql = self._index_sql(spec, create=create)
        self._postgres(
            "/usr/bin/psql", "-X", "--no-psqlrc", "-v", "ON_ERROR_STOP=1",
            "--single-transaction", "-d", database, "-c", sql, timeout=180,
        )

    def _database_schema_hash(self) -> str:
        return self._postgres_hash(
            "/usr/bin/pg_dump",
            "--schema-only",
            "--no-owner",
            "--no-privileges",
            "--restrict-key=PhishtopiaOpsFingerprint1",
            "-d",
            DATABASE,
            timeout=180,
        )

    def _production_invariants(self) -> dict[str, Any]:
        self._run(["/usr/sbin/nginx", "-t"], timeout=20)
        nginx = hashlib.sha256()
        for path in sorted(Path("/etc/nginx").rglob("*")):
            if path.is_file():
                nginx.update(str(path).encode())
                nginx.update(b"\x00")
                nginx.update(path.read_bytes())
                nginx.update(b"\x00")
        dns: dict[str, list[str]] = {}
        for hostname in ("phishtopia.com", "www.phishtopia.com"):
            dns[hostname] = sorted(
                {
                    address[4][0]
                    for address in socket.getaddrinfo(
                        hostname, 443, type=socket.SOCK_STREAM
                    )
                }
            )
            if not dns[hostname]:
                raise PlatformError("dns_status_unavailable")
        traffic = self._cloud_run_service().get("status", {}).get("traffic")
        if not isinstance(traffic, list):
            raise PlatformError("cloud_run_traffic_unavailable")
        env_hash = hashlib.sha256(self._safe_env_read()).hexdigest()
        return {
            "database_schema": self._database_schema_hash(),
            "nginx": nginx.hexdigest(),
            "dns": dns,
            "cloud_run_traffic": traffic,
            "app_env": env_hash,
            "error_signal": self._error_signal(),
        }

    def _verify_production_invariants(
        self,
        baseline: dict[str, Any],
        *,
        ignored: frozenset[str] = frozenset(),
    ) -> None:
        expected = baseline.get("production_invariants")
        if not isinstance(expected, dict):
            raise PlatformError("production_baseline_missing")
        actual = self._production_invariants()
        keys = {
            "database_schema",
            "nginx",
            "dns",
            "cloud_run_traffic",
            "app_env",
        } - ignored
        if any(actual.get(key) != expected.get(key) for key in keys):
            raise PlatformError("production_invariant_changed")
        if "error_signal" not in ignored:
            self._verify_error_signal(expected.get("error_signal"), actual["error_signal"])
        self._pm2_status()
        self._public_health(PUBLIC_HEALTH)
        self._public_health(PUBLIC_ROOT)
        self._verify_session_cookie()

    @staticmethod
    def _error_signal() -> dict[str, int | bool]:
        try:
            details = APP_ERROR_LOG.stat(follow_symlinks=False)
        except FileNotFoundError:
            return {"present": False, "device": 0, "inode": 0, "size": 0, "markers": 0}
        if (
            not stat.S_ISREG(details.st_mode)
            or details.st_nlink != 1
            or details.st_size > 64 * 1024 * 1024
            or details.st_mode & 0o022
        ):
            raise PlatformError("error_signal_target_unsafe")
        markers = 0
        tail = b""
        with APP_ERROR_LOG.open("rb") as handle:
            while chunk := handle.read(262_144):
                combined = tail + chunk
                markers += combined.count(b" [ERROR] ")
                tail = combined[-8:]
        return {
            "present": True,
            "device": details.st_dev,
            "inode": details.st_ino,
            "size": details.st_size,
            "markers": markers,
        }

    @staticmethod
    def _verify_error_signal(expected: Any, actual: Any) -> None:
        if not isinstance(expected, dict) or not isinstance(actual, dict):
            raise PlatformError("error_signal_baseline_missing")
        if expected.get("present") is False and actual.get("present") is False:
            return
        if expected.get("present") is False and actual.get("present") is True:
            if actual.get("markers") == 0:
                return
            raise PlatformError("post_change_error_detected")
        if (
            actual.get("present") is not True
            or actual.get("device") != expected.get("device")
            or actual.get("inode") != expected.get("inode")
            or type(actual.get("markers")) is not int
            or type(expected.get("markers")) is not int
            or actual["markers"] < expected["markers"]
        ):
            raise PlatformError("error_signal_discontinuous")
        if actual["markers"] > expected["markers"]:
            raise PlatformError("post_change_error_detected")

    @staticmethod
    def _unsafe_sql(sql: str) -> bool:
        stripped = re.sub(r"--[^\n]*|/\*.*?\*/", " ", sql, flags=re.S).lower()
        forbidden = r"\b(drop|truncate|delete|update|insert|copy|grant|revoke|vacuum|reindex|cluster|alter\s+system|create\s+extension)\b|\\|\bexecute\b|\bdo\s+\$"
        return bool(re.search(forbidden, stripped)) or len(sql.encode()) > 256_000

    def _secret_versions(self) -> list[str]:
        value = self._gcloud_json(
            "secrets", "versions", "list", SESSION_SECRET, f"--project={PROJECT_ID}",
            "--filter=state=ENABLED", "--format=json", timeout=30
        )
        if not isinstance(value, list):
            raise PlatformError("invalid_secret_metadata")
        return [str(item.get("name", "")).split("/")[-1] for item in value if isinstance(item, dict) and str(item.get("name", "")).split("/")[-1].isdigit()]

    def _dns_token(self) -> str:
        token = self._gcloud(
            "secrets", "versions", "access", "latest", f"--secret={DNS_TOKEN_SECRET}",
            f"--project={PROJECT_ID}", timeout=30
        ).decode().strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]{30,200}", token):
            raise PlatformError("dns_credential_unavailable")
        return token

    def _dns_scope_preflight(self) -> None:
        token = self._dns_token()
        probes = (
            {
                "hostname": "phishtopia.com",
                "recordType": "A",
                "value": sorted(DNS_A_TARGETS)[0],
            },
            {
                "hostname": "www.phishtopia.com",
                "recordType": "CNAME",
                "value": sorted(DNS_CNAME_TARGETS)[0],
            },
        )
        for probe in probes:
            self._cloudflare_zone_and_record(probe, token)
        token = ""

    def _cloudflare_zone_and_record(
        self, action: dict[str, Any], token: str
    ) -> tuple[str, dict[str, Any], list[str]]:
        zone_result = self._cloudflare_request("zones?name=phishtopia.com&status=active", token)
        zones = zone_result.get("result", []) if isinstance(zone_result, dict) else []
        if len(zones) != 1 or not isinstance(zones[0], dict) or not re.fullmatch(r"[0-9a-f]{32}", str(zones[0].get("id", ""))):
            raise PlatformError("cloudflare_zone_not_unique")
        zone = zones[0]["id"]
        nameservers = zones[0].get("name_servers")
        if (
            not isinstance(nameservers, list)
            or len(nameservers) < 2
            or any(
                not isinstance(name, str)
                or not re.fullmatch(r"[a-z0-9-]+\.ns\.cloudflare\.com", name)
                for name in nameservers
            )
        ):
            raise PlatformError("authoritative_nameservers_invalid")
        query = urllib.parse.urlencode({"name": action["hostname"], "type": action["recordType"], "per_page": "2"})
        record_result = self._cloudflare_request(f"zones/{zone}/dns_records?{query}", token)
        records = record_result.get("result", []) if isinstance(record_result, dict) else []
        if len(records) != 1 or not isinstance(records[0], dict):
            raise PlatformError("dns_record_not_unique")
        current_target = str(records[0].get("content", "")).rstrip(".").lower()
        allowed_targets = (
            DNS_A_TARGETS if action["recordType"] == "A" else DNS_CNAME_TARGETS
        )
        if (
            records[0].get("proxied") is not False
            or records[0].get("name") != action["hostname"]
            or records[0].get("type") != action["recordType"]
            or current_target not in allowed_targets
        ):
            raise PlatformError("dns_record_not_dns_only")
        return zone, records[0], nameservers

    def _cloudflare_record(self, action: dict[str, Any]) -> dict[str, Any]:
        token = self._dns_token()
        zone, record, _nameservers = self._cloudflare_zone_and_record(action, token)
        return {"zone": zone, "record": record}

    def _cloudflare_restore(self, record: dict[str, Any]) -> None:
        if set(record) != {"zone", "record"} or not isinstance(record["record"], dict):
            raise PlatformError("invalid_dns_rollback_baseline")
        snapshot = record["record"]
        snapshot_type = snapshot.get("type")
        snapshot_target = str(snapshot.get("content", "")).rstrip(".").lower()
        allowed_targets = (
            DNS_A_TARGETS if snapshot_type == "A" else DNS_CNAME_TARGETS
        )
        if (
            snapshot.get("name") not in {"phishtopia.com", "www.phishtopia.com"}
            or snapshot.get("proxied") is not False
            or snapshot_type not in {"A", "CNAME"}
            or snapshot_target not in allowed_targets
        ):
            raise PlatformError("invalid_dns_rollback_baseline")
        if not re.fullmatch(r"[0-9a-f]{32}", str(record["zone"])) or not re.fullmatch(r"[0-9a-f]{32}", str(snapshot.get("id", ""))):
            raise PlatformError("invalid_dns_rollback_baseline")
        token = self._dns_token()
        payload = {
            key: snapshot[key]
            for key in ("type", "name", "content", "ttl", "proxied")
        }
        for optional in ("comment", "tags", "settings"):
            if optional in snapshot:
                payload[optional] = snapshot[optional]
        self._cloudflare_request(
            f"zones/{record['zone']}/dns_records/{snapshot['id']}",
            token,
            method="PUT",
            payload=payload,
        )
        action = {
            "hostname": snapshot["name"],
            "recordType": snapshot["type"],
            "value": snapshot["content"],
        }
        _zone, _current, nameservers = self._cloudflare_zone_and_record(action, token)
        self._wait_dns(action, nameservers)
        self._public_hostname_health(snapshot["name"])

    def _cloudflare_request(self, path: str, token: str, *, method: str = "GET", payload: dict[str, Any] | None = None) -> dict[str, Any]:
        if not re.fullmatch(r"zones(?:\?name=phishtopia\.com&status=active|/[0-9a-f]{32}/dns_records(?:\?[^\r\n]+|/[0-9a-f]{32}))?", path):
            raise PlatformError("cloudflare_path_not_allowlisted")
        body = json.dumps(payload, separators=(",", ":")).encode() if payload is not None else None
        request = urllib.request.Request(
            f"https://api.cloudflare.com/client/v4/{path}", data=body, method=method,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json", "User-Agent": "phishtopia-ops-worker/1"},
        )
        try:
            with self._urlopen(request, timeout=20) as response:
                data = response.read(1_000_001)
        except (urllib.error.URLError, TimeoutError) as error:
            raise PlatformError("cloudflare_unavailable") from error
        if len(data) > 1_000_000:
            raise PlatformError("cloudflare_response_too_large")
        value = json.loads(data)
        if not isinstance(value, dict) or value.get("success") is not True:
            raise PlatformError("cloudflare_rejected")
        return value

    def _wait_dns(self, action: dict[str, Any], nameservers: list[str]) -> None:
        endpoints = (
            "https://cloudflare-dns.com/dns-query",
            "https://dns.google/resolve",
            "https://dns.quad9.net:5053/dns-query",
        )
        expected = action["value"].rstrip(".").lower()
        for _ in range(24):
            matched = 0
            for endpoint in endpoints:
                query = urllib.parse.urlencode({"name": action["hostname"], "type": action["recordType"]})
                request = urllib.request.Request(f"{endpoint}?{query}", headers={"Accept": "application/dns-json", "User-Agent": "phishtopia-ops-worker/1"})
                try:
                    with self._urlopen(request, timeout=8) as response:
                        value = json.loads(response.read(200_000))
                    answers = value.get("Answer", []) if isinstance(value, dict) else []
                    if expected in {str(answer.get("data", "")).rstrip(".").lower() for answer in answers if isinstance(answer, dict)}:
                        matched += 1
                except Exception:
                    continue
            authoritative = sum(
                1
                for nameserver in nameservers
                if expected
                in self._authoritative_dns_answers(
                    nameserver, action["hostname"], action["recordType"]
                )
            )
            if matched >= 2 and authoritative >= 2:
                return
            self._pause(5)
        raise PlatformError("dns_convergence_timeout")

    @classmethod
    def _authoritative_dns_answers(
        cls, nameserver: str, hostname: str, record_type: str
    ) -> set[str]:
        type_code = {"A": 1, "CNAME": 5, "AAAA": 28}.get(record_type)
        if type_code is None:
            raise PlatformError("dns_type_not_allowlisted")
        identifier = secrets.randbelow(65_536)
        question = b"".join(
            bytes((len(label),)) + label.encode("ascii")
            for label in hostname.rstrip(".").split(".")
        ) + b"\x00" + struct.pack("!HH", type_code, 1)
        packet = struct.pack("!HHHHHH", identifier, 0, 1, 0, 0, 0) + question
        for family, socktype, protocol, _canonname, address in socket.getaddrinfo(
            nameserver, 53, type=socket.SOCK_DGRAM
        ):
            query = socket.socket(family, socktype, protocol)
            try:
                query.settimeout(3)
                query.sendto(packet, address)
                response = query.recv(65_535)
                return cls._parse_dns_answers(
                    response, identifier, type_code, require_authoritative=True
                )
            except (OSError, PlatformError):
                continue
            finally:
                query.close()
        return set()

    @classmethod
    def _parse_dns_answers(
        cls,
        data: bytes,
        identifier: int,
        expected_type: int,
        *,
        require_authoritative: bool,
    ) -> set[str]:
        if len(data) < 12:
            raise PlatformError("dns_response_invalid")
        response_id, flags, questions, answers, _authority, _additional = struct.unpack(
            "!HHHHHH", data[:12]
        )
        if (
            response_id != identifier
            or flags & 0x8000 == 0
            or flags & 0x000F != 0
            or (require_authoritative and flags & 0x0400 == 0)
        ):
            raise PlatformError("dns_response_invalid")
        offset = 12
        for _ in range(questions):
            _name, offset = cls._dns_name(data, offset)
            offset += 4
        values: set[str] = set()
        for _ in range(answers):
            _name, offset = cls._dns_name(data, offset)
            if offset + 10 > len(data):
                raise PlatformError("dns_response_invalid")
            record_type, record_class, _ttl, length = struct.unpack(
                "!HHIH", data[offset : offset + 10]
            )
            offset += 10
            end = offset + length
            if end > len(data):
                raise PlatformError("dns_response_invalid")
            if record_class == 1 and record_type == expected_type:
                if record_type == 1 and length == 4:
                    values.add(socket.inet_ntop(socket.AF_INET, data[offset:end]))
                elif record_type == 28 and length == 16:
                    values.add(socket.inet_ntop(socket.AF_INET6, data[offset:end]))
                elif record_type == 5:
                    cname, _unused = cls._dns_name(data, offset)
                    values.add(cname.rstrip(".").lower())
            offset = end
        return values

    @staticmethod
    def _dns_name(data: bytes, offset: int) -> tuple[str, int]:
        labels: list[str] = []
        next_offset = offset
        jumped = False
        seen: set[int] = set()
        for _ in range(128):
            if offset >= len(data) or offset in seen:
                raise PlatformError("dns_response_invalid")
            seen.add(offset)
            length = data[offset]
            if length & 0xC0 == 0xC0:
                if offset + 1 >= len(data):
                    raise PlatformError("dns_response_invalid")
                pointer = ((length & 0x3F) << 8) | data[offset + 1]
                if not jumped:
                    next_offset = offset + 2
                    jumped = True
                offset = pointer
                continue
            if length == 0:
                if not jumped:
                    next_offset = offset + 1
                return ".".join(labels), next_offset
            if length > 63 or offset + 1 + length > len(data):
                raise PlatformError("dns_response_invalid")
            try:
                labels.append(data[offset + 1 : offset + 1 + length].decode("ascii"))
            except UnicodeDecodeError as error:
                raise PlatformError("dns_response_invalid") from error
            offset += 1 + length
            if not jumped:
                next_offset = offset
        raise PlatformError("dns_response_invalid")

    def _verify_ops(self) -> None:
        self._systemctl("is-active", OPS_UNIT, timeout=15)
        self._run([str(OPS_NODE), str(OPS_CURRENT / "dist/smoke/protocol-smoke.js")], cwd=OPS_CURRENT, timeout=60)
        self._run(
            self._as_account(
                "phishtopia-mcp",
                [
                    "/usr/bin/env",
                    "HOME=/var/lib/phishtopia-ops-mcp",
                    str(OPS_NODE),
                    str(OPS_CURRENT / "dist/smoke/worker-contract-smoke.js"),
                ],
            ),
            cwd=OPS_CURRENT,
            timeout=30,
        )
        with socket.create_connection(
            ("127.0.0.1", 18081), timeout=self._bounded_timeout(5)
        ):
            pass

    @staticmethod
    def _session_cookie_uses_secret(cookie: str, secret: str) -> bool:
        if re.fullmatch(r"[A-Za-z0-9_-]{48,128}", secret) is None:
            raise PlatformError("session_secret_consumer_mismatch")
        if not cookie.startswith("sid=") or len(cookie) > 512:
            return False
        decoded = urllib.parse.unquote(cookie.removeprefix("sid="))
        if not decoded.startswith("s:") or "." not in decoded:
            return False
        session_id, observed = decoded.removeprefix("s:").rsplit(".", 1)
        if (
            not session_id
            or len(session_id) > 256
            or re.fullmatch(r"[A-Za-z0-9_-]+", session_id) is None
            or re.fullmatch(r"[A-Za-z0-9+/]{43}", observed) is None
        ):
            return False
        expected = base64.b64encode(
            hmac.new(secret.encode(), session_id.encode(), hashlib.sha256).digest()
        ).decode().rstrip("=")
        return hmac.compare_digest(observed, expected)

    def _verify_session_cookie(
        self, *, expected_session_secret: str | None = None
    ) -> None:
        connection = http.client.HTTPSConnection(
            "phishtopia.com",
            443,
            timeout=self._bounded_timeout(10),
            context=ssl.create_default_context(),
        )
        cookie = ""
        try:
            connection.request(
                "GET",
                "/youlist",
                headers={"User-Agent": "phishtopia-ops-worker/1"},
            )
            response = connection.getresponse()
            response.read(16_384)
            set_cookie = response.getheader("Set-Cookie") or ""
            cookie = set_cookie.split(";", 1)[0]
            attributes = {part.strip().lower() for part in set_cookie.split(";")[1:]}
            if (
                response.status not in {302, 303}
                or response.getheader("Location") != "/auth/login"
                or not cookie.startswith("sid=")
                or len(cookie) > 512
                or not {"httponly", "secure", "samesite=lax"} <= attributes
            ):
                raise PlatformError("session_cookie_validation_failed")
            if expected_session_secret is not None and not self._session_cookie_uses_secret(
                cookie, expected_session_secret
            ):
                raise PlatformError("session_secret_consumer_mismatch")
        finally:
            connection.close()
            if cookie:
                cleanup = http.client.HTTPSConnection(
                    "phishtopia.com",
                    443,
                    timeout=self._bounded_timeout(10),
                    context=ssl.create_default_context(),
                )
                try:
                    cleanup.request(
                        "POST",
                        "/auth/logout",
                        body=b"",
                        headers={
                            "Cookie": cookie,
                            "Content-Length": "0",
                            "User-Agent": "phishtopia-ops-worker/1",
                        },
                    )
                    cleared = cleanup.getresponse()
                    cleared.read(16_384)
                    if cleared.status not in {302, 303}:
                        raise PlatformError("synthetic_session_cleanup_failed")
                finally:
                    cleanup.close()

    def _verify_tls(self) -> None:
        context = ssl.create_default_context()
        with socket.create_connection(
            ("phishtopia.com", 443), timeout=self._bounded_timeout(10)
        ) as plain:
            with context.wrap_socket(plain, server_hostname="phishtopia.com") as secured:
                if not secured.getpeercert():
                    raise PlatformError("tls_validation_failed")

    def _public_hostname_health(self, hostname: str) -> None:
        if hostname not in {"phishtopia.com", "www.phishtopia.com"}:
            raise PlatformError("health_hostname_not_allowlisted")
        request = urllib.request.Request(
            f"https://{hostname}/health",
            headers={"Accept": "text/plain", "User-Agent": "phishtopia-ops-worker/1"},
        )
        allowed_redirects = frozenset(
            {
                (hostname, hostname),
                ("www.phishtopia.com", "phishtopia.com"),
            }
        )
        try:
            with self._urlopen(
                request, timeout=10, redirects=allowed_redirects
            ) as response:
                response.read(16_384)
                if response.status != 200:
                    raise PlatformError("public_hostname_health_failed")
        except (urllib.error.URLError, TimeoutError) as error:
            raise PlatformError("public_hostname_health_failed") from error

    def _public_health(self, url: str) -> None:
        if url not in {PUBLIC_HEALTH, PUBLIC_ROOT}:
            raise PlatformError("health_url_not_allowlisted")
        request = urllib.request.Request(url, headers={"Accept": "text/plain", "User-Agent": "phishtopia-ops-worker/1"})
        try:
            with self._urlopen(request, timeout=10) as response:
                response.read(16_384)
                if response.status != 200:
                    raise PlatformError("public_health_failed")
        except (urllib.error.URLError, TimeoutError) as error:
            raise PlatformError("public_health_failed") from error

    def _systemctl(self, verb: str, unit: str, *, timeout: int) -> bytes:
        if verb not in {"is-active", "restart"} or unit != OPS_UNIT:
            raise PlatformError("systemd_operation_not_allowlisted")
        return self._run(["/usr/bin/systemctl", verb, unit], timeout=timeout)

    def _pm2(self, *arguments: str, timeout: int) -> bytes:
        if tuple(arguments[:2]) not in {("reload", PM2_NAME)}:
            raise PlatformError("pm2_operation_not_allowlisted")
        return self._run(
            self._as_account(
                "codespace",
                [
                    "/usr/bin/env",
                    "HOME=/home/codespace",
                    "PM2_HOME=/home/codespace/.pm2",
                    "/usr/bin/pm2",
                    *arguments,
                ],
            ),
            timeout=timeout,
        )

    def _pm2_status(self) -> dict[str, Any]:
        output = self._run(
            self._as_account(
                "codespace",
                [
                    "/usr/bin/env",
                    "HOME=/home/codespace",
                    "PM2_HOME=/home/codespace/.pm2",
                    "/usr/bin/pm2",
                    "jlist",
                ],
            ),
            timeout=20,
        )
        value = json.loads(output)
        matches = [item for item in value if isinstance(item, dict) and item.get("name") == PM2_NAME]
        if len(matches) != 1 or matches[0].get("pm2_env", {}).get("status") != "online":
            raise PlatformError("pm2_app_not_healthy")
        return {"name": PM2_NAME, "status": "online", "pid": matches[0].get("pid")}

    def _postgres(self, executable: str, *arguments: str, timeout: int) -> bytes:
        self._validate_postgres_command(executable, arguments)
        return self._run(
            self._as_account(
                "postgres",
                [
                    "/usr/bin/env",
                    "HOME=/var/lib/postgresql",
                    "PSQL_HISTORY=/dev/null",
                    executable,
                    *arguments,
                ],
            ),
            timeout=timeout,
        )

    def _postgres_hash(self, executable: str, *arguments: str, timeout: int) -> str:
        self._validate_postgres_command(executable, arguments)
        bounded = self._bounded_timeout(timeout)
        return self.runner.hash_run(
            self._as_account(
                "postgres",
                [
                    "/usr/bin/env",
                    "HOME=/var/lib/postgresql",
                    "PSQL_HISTORY=/dev/null",
                    executable,
                    *arguments,
                ],
            ),
            timeout=bounded,
            check=self._guard,
        )

    @staticmethod
    def _as_account(account: str, command: list[str]) -> list[str]:
        if account not in {"codespace", "postgres", "phishtopia-mcp"}:
            raise PlatformError("account_not_allowlisted")
        if not command or command[0] != "/usr/bin/env":
            raise PlatformError("account_command_not_allowlisted")
        return [
            "/usr/bin/setpriv",
            f"--reuid={account}",
            f"--regid={account}",
            "--init-groups",
            "--no-new-privs",
            "--",
            *command,
        ]

    @staticmethod
    def _validate_postgres_command(executable: str, arguments: tuple[str, ...]) -> None:
        rehearsal = r"ops_rehearsal_[0-9a-f]{20}"
        database = rf"(?:{re.escape(DATABASE)}|{rehearsal})"
        joined = "\x1f".join(arguments)
        if executable == "/usr/bin/pg_dump":
            fingerprint = re.fullmatch(
                rf"--(?:schema|data)-only\x1f--no-owner\x1f--no-privileges\x1f"
                rf"--restrict-key=PhishtopiaOpsFingerprint1\x1f-d\x1f{database}",
                joined,
            )
            backup = re.fullmatch(
                rf"-Fc\x1f-d\x1f{re.escape(DATABASE)}\x1f-f\x1f"
                r"/tmp/phishtopia-ops-migration-[0-9a-f-]{36}/backup\.dump",
                joined,
            )
            if fingerprint or backup:
                return
        elif executable == "/usr/bin/createdb" and re.fullmatch(rehearsal, joined):
            return
        elif executable == "/usr/bin/dropdb" and re.fullmatch(
            rf"--if-exists\x1f{rehearsal}", joined
        ):
            return
        elif executable == "/usr/bin/pg_restore" and re.fullmatch(
            rf"-d\x1f{rehearsal}\x1f"
            r"/tmp/phishtopia-ops-migration-[0-9a-f-]{36}/backup\.dump",
            joined,
        ):
            return
        elif executable == "/usr/bin/psql":
            size_query = re.fullmatch(
                rf"-X\x1f--no-psqlrc\x1f-At\x1f-d\x1f{re.escape(DATABASE)}\x1f-c\x1f"
                r"SELECT pg_database_size\(current_database\(\)\);",
                joined,
            )
            query = re.fullmatch(
                rf"-X\x1f--no-psqlrc\x1f-At\x1f-d\x1f{database}\x1f-c\x1f"
                r"SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname='"
                r"ops_[0-9]{14}_[0-9a-f]{12}_idx' LIMIT 1;",
                joined,
            )
            mutation = re.fullmatch(
                rf"-X\x1f--no-psqlrc\x1f-v\x1fON_ERROR_STOP=1\x1f--single-transaction\x1f-d\x1f{database}\x1f-c\x1f"
                r"(?:CREATE INDEX \"ops_[0-9]{14}_[0-9a-f]{12}_idx\" ON \"public\"\.\"session\" \(\"expire\"\);|"
                r"DROP INDEX IF EXISTS \"public\"\.\"ops_[0-9]{14}_[0-9a-f]{12}_idx\";)",
                joined,
            )
            if size_query or query or mutation:
                return
        raise PlatformError("postgres_command_not_allowlisted")

    def _gcloud(self, *arguments: str, timeout: int, input_bytes: bytes | None = None) -> bytes:
        if f"--project={PROJECT_ID}" not in arguments:
            raise PlatformError("gcloud_project_missing")
        return self._run(["/usr/bin/gcloud", *arguments], timeout=timeout, input_bytes=input_bytes)

    def _gcloud_json(self, *arguments: str, timeout: int) -> Any:
        try:
            return json.loads(self._gcloud(*arguments, timeout=timeout))
        except json.JSONDecodeError as error:
            raise PlatformError("invalid_gcloud_response") from error

    def _urlopen(
        self,
        request: urllib.request.Request,
        *,
        timeout: int,
        redirects: frozenset[tuple[str, str]] = frozenset(),
    ) -> Any:
        if self._guard is not None:
            self._guard()
        opener = urllib.request.build_opener(
            FixedRedirectHandler(redirects),
            urllib.request.HTTPSHandler(context=ssl.create_default_context()),
        )
        response = opener.open(request, timeout=self._bounded_timeout(timeout))
        if self._guard is not None:
            self._guard()
        return response

    def _run(self, command: list[str], *, timeout: int, cwd: Path | None = None, input_bytes: bytes | None = None) -> bytes:
        bounded = self._bounded_timeout(timeout)
        return self.runner.run(
            command,
            timeout=bounded,
            cwd=cwd,
            input_bytes=input_bytes,
            check=self._guard,
        )

    def _bounded_timeout(self, maximum: int) -> int:
        if self._guard is None:
            return maximum
        remaining = getattr(self._guard, "remaining_seconds", None)
        if not callable(remaining):
            self._guard()
            return maximum
        return int(remaining(maximum))

    def _pause(self, seconds: int) -> None:
        end = time.monotonic() + seconds
        while time.monotonic() < end:
            if self._guard is not None:
                self._guard()
            time.sleep(min(0.5, end - time.monotonic()))

    @staticmethod
    def _memory_available() -> int:
        for line in Path("/proc/meminfo").read_text().splitlines():
            if line.startswith("MemAvailable:"):
                return int(line.split()[1]) * 1024
        raise PlatformError("memory_status_unavailable")

    @staticmethod
    def _current_target(path: Path) -> str:
        if path.is_symlink():
            return str(path.resolve(strict=True))
        if path.is_dir():
            return str(path)
        raise PlatformError("current_release_missing")

    def _restore_target(self, current: Path, target_value: Any) -> None:
        if not isinstance(target_value, str):
            raise PlatformError("rollback_target_missing")
        target = Path(target_value)
        allowed_root = APP_RELEASES if current == APP_CURRENT else OPS_RELEASES
        if target == current and current.is_dir() and not current.is_symlink():
            return
        if target.parent != allowed_root or not target.is_dir():
            raise PlatformError("rollback_target_not_allowlisted")
        self._switch_symlink(current, target)

    @staticmethod
    def _switch_symlink(current: Path, target: Path) -> None:
        allowed = (current == OPS_CURRENT and target.parent == OPS_RELEASES) or (current == APP_CURRENT and target.parent == APP_RELEASES)
        if not allowed or not target.is_dir():
            raise PlatformError("release_path_not_allowlisted")
        if current.exists() and not current.is_symlink():
            raise PlatformError("legacy_release_requires_bootstrap")
        temporary = current.with_name(current.name + ".next")
        temporary.unlink(missing_ok=True)
        temporary.symlink_to(target)
        os.replace(temporary, current)
        parent = os.open(
            current.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        )
        try:
            os.fsync(parent)
        finally:
            os.close(parent)

    @staticmethod
    def _fsync_directories(*directories: Path) -> None:
        for directory in dict.fromkeys(directories):
            descriptor = os.open(
                directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
            )
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)

    @staticmethod
    def _validated_candidate(path: Path) -> Path:
        try:
            resolved = path.resolve(strict=True)
            relative = resolved.relative_to(STAGING_ROOT.resolve(strict=True))
        except (OSError, RuntimeError, ValueError) as error:
            raise PlatformError("candidate_path_not_allowlisted") from error
        if (
            not relative.parts
            or re.fullmatch(r"extract-[0-9a-f]{40}", relative.parts[0]) is None
            or len(relative.parts) > 5
        ):
            raise PlatformError("candidate_path_not_allowlisted")
        return resolved

    @staticmethod
    def _chown_tree(path: Path, uid: int, gid: int) -> None:
        os.chown(path, uid, gid, follow_symlinks=False)
        for root, directories, files in os.walk(path, followlinks=False):
            for name in (*directories, *files):
                os.chown(Path(root) / name, uid, gid, follow_symlinks=False)

    def _sandbox_run(
        self,
        candidate: Path,
        command: list[str],
        *,
        timeout: int,
        registry_network: bool = False,
    ) -> bytes:
        candidate = self._validated_candidate(candidate)
        if not command or command[0] not in {
            str(OPS_NODE),
            str(OPS_NPM),
            "/usr/bin/cp",
            "/usr/bin/python3",
        }:
            raise PlatformError("candidate_command_not_allowlisted")
        try:
            pwd.getpwnam("phishtopia-build")
        except KeyError as error:
            raise PlatformError("build_identity_missing") from error
        relative = candidate.relative_to(STAGING_ROOT.resolve(strict=True))
        commit = relative.parts[0].removeprefix("extract-")
        unit = f"phishtopia-build-{commit[:12]}"
        bounded_timeout = self._bounded_timeout(timeout)
        properties = [
                "/usr/bin/systemd-run",
                f"--unit={unit}",
                "--wait",
                "--collect",
                "--quiet",
                "--pipe",
                "--uid=phishtopia-build",
                f"--working-directory={candidate}",
                "--setenv=HOME=/var/lib/phishtopia-build",
                "--setenv=NO_COLOR=1",
                "--setenv=PYTHONDONTWRITEBYTECODE=1",
                "--property=PrivateTmp=yes",
                "--property=PrivateDevices=yes",
                "--property=NoNewPrivileges=yes",
                "--property=ProtectSystem=strict",
                "--property=ProtectHome=read-only",
                "--property=ProtectKernelTunables=yes",
                "--property=ProtectKernelModules=yes",
                "--property=ProtectKernelLogs=yes",
                "--property=ProtectControlGroups=yes",
                "--property=RestrictSUIDSGID=yes",
                "--property=LockPersonality=yes",
                "--property=CapabilityBoundingSet=",
                "--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
                "--property=TasksMax=64",
                "--property=MemoryMax=384M",
                "--property=LimitFSIZE=64M",
                f"--property=RuntimeMaxSec={bounded_timeout}",
                f"--property=ReadWritePaths={candidate}",
        ]
        if registry_network:
            hosts, addresses = self._registry_network_policy()
            properties.extend(
                [
                    "--property=IPAddressDeny=any",
                    *(f"--property=IPAddressAllow={address}" for address in addresses),
                    f"--property=BindReadOnlyPaths={hosts}:/etc/hosts",
                    "--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
                    "--property=ReadWritePaths=/var/lib/phishtopia-build/npm-cache",
                ]
            )
        else:
            properties.append("--property=PrivateNetwork=yes")
        return self._run(
            [*properties, "--", *command],
            timeout=bounded_timeout,
        )

    @staticmethod
    def _source_digest(candidate: Path) -> str:
        digest = hashlib.sha256()
        for path in sorted(candidate.rglob("*")):
            relative = path.relative_to(candidate)
            if relative.parts[0] in {"dist", "node_modules"} or relative.as_posix() == ".env":
                continue
            details = path.lstat()
            if stat.S_ISLNK(details.st_mode):
                raise PlatformError("artifact_symlink_rejected")
            digest.update(relative.as_posix().encode())
            digest.update(b"\x00")
            if stat.S_ISREG(details.st_mode):
                with path.open("rb") as handle:
                    while chunk := handle.read(1_048_576):
                        digest.update(chunk)
            elif not stat.S_ISDIR(details.st_mode):
                raise PlatformError("artifact_entry_rejected")
            digest.update(b"\x00")
        return digest.hexdigest()

    @staticmethod
    def _validate_npm_lock(candidate: Path) -> None:
        try:
            lock = json.loads((candidate / "package-lock.json").read_text(encoding="utf8"))
        except (OSError, json.JSONDecodeError) as error:
            raise PlatformError("package_lock_invalid") from error
        packages = lock.get("packages") if isinstance(lock, dict) else None
        if lock.get("lockfileVersion") != 3 or not isinstance(packages, dict):
            raise PlatformError("package_lock_invalid")
        for name, metadata in packages.items():
            if not isinstance(name, str) or not isinstance(metadata, dict):
                raise PlatformError("package_lock_invalid")
            resolved = metadata.get("resolved")
            if resolved is None:
                continue
            integrity = metadata.get("integrity")
            if (
                not isinstance(resolved, str)
                or not resolved.startswith("https://registry.npmjs.org/")
                or not isinstance(integrity, str)
                or re.fullmatch(r"sha512-[A-Za-z0-9+/=]+", integrity) is None
            ):
                raise PlatformError("package_source_not_allowlisted")

    @staticmethod
    def _registry_network_policy() -> tuple[Path, list[str]]:
        addresses: set[str] = set()
        for result in socket.getaddrinfo(
            "registry.npmjs.org", 443, type=socket.SOCK_STREAM
        ):
            address = result[4][0]
            parsed = ipaddress.ip_address(address)
            if not parsed.is_global:
                raise PlatformError("registry_address_not_public")
            addresses.add(str(parsed))
        if not addresses or len(addresses) > 16:
            raise PlatformError("registry_address_set_invalid")
        hosts = STATE_ROOT / "npm-registry.hosts"
        descriptor = os.open(
            hosts,
            os.O_CREAT | os.O_TRUNC | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0),
            0o600,
        )
        try:
            os.write(
                descriptor,
                b"127.0.0.1 localhost\n::1 localhost\n"
                + b"".join(
                    f"{address} registry.npmjs.org\n".encode()
                    for address in sorted(addresses)
                ),
            )
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.chmod(hosts, 0o644)
        return hosts, sorted(addresses)

    def _prepare_candidate(
        self,
        candidate: Path,
        *,
        dependency_source: Path,
        kind: str,
    ) -> None:
        candidate = self._validated_candidate(candidate)
        del dependency_source
        if kind not in {"app", "ops"}:
            raise PlatformError("candidate_kind_invalid")
        modules = candidate / "node_modules"
        if modules.exists() or modules.is_symlink():
            raise PlatformError("artifact_contains_dependencies")
        self._validate_npm_lock(candidate)
        pristine_source = self._source_digest(candidate)
        try:
            account = pwd.getpwnam("phishtopia-build")
        except KeyError as error:
            raise PlatformError("build_identity_missing") from error
        self._chown_tree(candidate, account.pw_uid, account.pw_gid)
        self._sandbox_run(
            candidate,
            [
                str(OPS_NODE),
                str(OPS_NPM_CLI),
                "ci",
                "--ignore-scripts",
                "--userconfig=/dev/null",
                "--registry=https://registry.npmjs.org",
                "--cache=/var/lib/phishtopia-build/npm-cache",
                "--no-audit",
                "--no-fund",
            ],
            timeout=300,
            registry_network=True,
        )
        if kind == "ops":
            compiler = candidate / "node_modules" / "typescript" / "bin" / "tsc"
            formatter = candidate / "node_modules" / "prettier" / "bin" / "prettier.cjs"
            for command in (
                [str(OPS_NODE), str(formatter), "--check", "."],
                [str(OPS_NODE), str(compiler), "--noEmit", "-p", "tsconfig.json"],
                [str(OPS_NODE), str(compiler), "-p", "tsconfig.json"],
                list(OPS_PYTHON_TEST_COMMAND),
            ):
                self._sandbox_run(candidate, command, timeout=240)
            tests = sorted((candidate / "dist" / "test").glob("*.test.js"))
            if not 1 <= len(tests) <= 200:
                raise PlatformError("candidate_tests_missing")
            self._sandbox_run(
                candidate,
                [str(OPS_NODE), "--test", *(str(path) for path in tests)],
                timeout=240,
            )
            self._sandbox_run(
                candidate,
                [str(OPS_NODE), str(candidate / "dist" / "smoke" / "protocol-smoke.js")],
                timeout=120,
            )
        else:
            tests = sorted((candidate / "test").glob("*.test.js"))
            if not 1 <= len(tests) <= 200:
                raise PlatformError("candidate_tests_missing")
            self._sandbox_run(
                candidate,
                [str(OPS_NODE), "--test", *(str(path) for path in tests)],
                timeout=240,
            )
        if self._source_digest(candidate) != pristine_source:
            raise PlatformError("candidate_source_mutated_by_tests")
        if modules.is_symlink() or (candidate / "dist").is_symlink():
            raise PlatformError("candidate_generated_path_unsafe")
        shutil.rmtree(modules)
        shutil.rmtree(candidate / "dist", ignore_errors=True)
        self._sandbox_run(
            candidate,
            [
                str(OPS_NODE),
                str(OPS_NPM_CLI),
                "ci",
                "--ignore-scripts",
                "--userconfig=/dev/null",
                "--registry=https://registry.npmjs.org",
                "--cache=/var/lib/phishtopia-build/npm-cache",
                "--no-audit",
                "--no-fund",
            ],
            timeout=300,
            registry_network=True,
        )
        if kind == "ops":
            compiler = candidate / "node_modules" / "typescript" / "bin" / "tsc"
            self._sandbox_run(
                candidate,
                [str(OPS_NODE), str(compiler), "-p", "tsconfig.json"],
                timeout=180,
            )
            generated = candidate / "dist"
            if not generated.is_dir() or generated.is_symlink() or any(
                path.is_symlink() for path in generated.rglob("*")
            ):
                raise PlatformError("candidate_generated_path_unsafe")
        if self._source_digest(candidate) != pristine_source:
            raise PlatformError("candidate_source_mutated_during_build")

    @classmethod
    def _install_release(cls, source: Path, destination: Path) -> None:
        if destination.exists() or destination.is_symlink():
            raise PlatformError("release_destination_exists")
        if destination.parent not in {APP_RELEASES, OPS_RELEASES} or re.fullmatch(
            r"[0-9a-f]{40}", destination.name
        ) is None:
            raise PlatformError("release_destination_not_allowlisted")
        destination.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
        temporary = destination.parent / f".install-{destination.name}-{secrets.token_hex(6)}"
        try:
            shutil.copytree(source, temporary, symlinks=True)
            cls._chown_tree(temporary, 0, 0)
            for root, directories, files in os.walk(temporary, followlinks=False):
                os.chmod(root, 0o755)
                for name in directories:
                    path = Path(root) / name
                    if not path.is_symlink():
                        os.chmod(path, 0o755)
                for name in files:
                    path = Path(root) / name
                    if not path.is_symlink():
                        os.chmod(path, 0o644)
            env_file = temporary / ".env"
            if env_file.exists():
                if env_file.is_symlink() or not env_file.is_file():
                    raise PlatformError("unsafe_app_env")
                owner, group = cls._codespace_identity()
                os.chown(env_file, owner, group, follow_symlinks=False)
                os.chmod(env_file, 0o600)
            os.rename(temporary, destination)
            parent = os.open(destination.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(parent)
            finally:
                os.close(parent)
        except Exception:
            if temporary.exists():
                shutil.rmtree(temporary)
            raise

    @staticmethod
    def _remove_new_release(action: dict[str, Any], baseline: dict[str, Any]) -> None:
        if baseline.get("destination_preexisting") is not False:
            return
        if action.get("type") == "upgrade_ops_release":
            release_root = OPS_RELEASES
        elif action.get("type") == "deploy_verified_release":
            release_root = APP_RELEASES
        else:
            return
        commit = action.get("commit")
        if not isinstance(commit, str) or re.fullmatch(r"[0-9a-f]{40}", commit) is None:
            raise PlatformError("release_cleanup_target_invalid")
        destination = release_root / commit
        if baseline.get("release_destination") != str(destination):
            raise PlatformError("release_cleanup_target_invalid")
        if destination.is_symlink():
            raise PlatformError("release_cleanup_target_unsafe")
        if destination.exists():
            if not destination.is_dir():
                raise PlatformError("release_cleanup_target_unsafe")
            shutil.rmtree(destination)
            parent = os.open(release_root, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(parent)
            finally:
                os.close(parent)

    @staticmethod
    def _app_commit(path: Path) -> str:
        resolved = path.resolve()
        if resolved.parent == APP_RELEASES and re.fullmatch(r"[0-9a-f]{40}", resolved.name):
            return resolved.name
        try:
            value = subprocess.run(
                ["/usr/bin/git", "-C", str(path), "rev-parse", "HEAD"],
                check=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10,
            ).stdout.decode().strip()
        except (subprocess.SubprocessError, OSError) as error:
            raise PlatformError("app_commit_unavailable") from error
        if not re.fullmatch(r"[0-9a-f]{40}", value):
            raise PlatformError("invalid_app_commit")
        return value

    @staticmethod
    def _replace_env_value(data: bytes, key: str, value: str) -> bytes:
        if key != "SESSION_SECRET" or not re.fullmatch(r"[A-Za-z0-9_-]{48,128}", value):
            raise PlatformError("env_value_not_allowlisted")
        try:
            lines = data.decode("utf8").splitlines()
        except UnicodeDecodeError as error:
            raise PlatformError("env_encoding_invalid") from error
        replacement = f"{key}={value}"
        found = False
        output: list[str] = []
        for line in lines:
            if line.startswith(f"{key}="):
                output.append(replacement)
                found = True
            else:
                output.append(line)
        if not found:
            output.append(replacement)
        return ("\n".join(output) + "\n").encode()

    @staticmethod
    def _validated_app_directory(directory: Path) -> Path:
        try:
            resolved = directory.resolve(strict=True)
        except (OSError, RuntimeError) as error:
            raise PlatformError("app_directory_unavailable") from error
        allowed = False
        if directory == APP_CURRENT:
            if APP_CURRENT.is_symlink():
                allowed = (
                    resolved.parent == APP_RELEASES
                    and re.fullmatch(r"[0-9a-f]{40}", resolved.name) is not None
                )
            else:
                allowed = resolved == APP_CURRENT
        elif resolved.parent == APP_RELEASES:
            allowed = re.fullmatch(r"[0-9a-f]{40}", resolved.name) is not None
        elif resolved.parent.parent == STAGING_ROOT:
            allowed = (
                re.fullmatch(r"extract-[0-9a-f]{40}", resolved.parent.name)
                is not None
            )
        if not allowed:
            raise PlatformError("app_directory_not_allowlisted")
        return resolved

    @staticmethod
    def _codespace_identity() -> tuple[int, int]:
        try:
            account = pwd.getpwnam("codespace")
        except KeyError as error:
            raise PlatformError("codespace_identity_missing") from error
        return account.pw_uid, account.pw_gid

    @classmethod
    def _open_app_directory(cls, directory: Path) -> int:
        resolved = cls._validated_app_directory(directory)
        flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
        try:
            descriptor = os.open(resolved, flags)
        except OSError as error:
            raise PlatformError("app_directory_unavailable") from error
        details = os.fstat(descriptor)
        if not stat.S_ISDIR(details.st_mode):
            os.close(descriptor)
            raise PlatformError("unsafe_app_directory")
        return descriptor

    @classmethod
    def _safe_env_read(cls) -> bytes:
        directory = cls._open_app_directory(APP_CURRENT)
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_CLOEXEC", 0)
        try:
            cls._cleanup_env_temporaries(directory)
            try:
                descriptor = os.open(".env", flags, dir_fd=directory)
            except OSError as error:
                raise PlatformError("app_env_unavailable") from error
            try:
                details = os.fstat(descriptor)
                owner, _group = cls._codespace_identity()
                if (
                    not stat.S_ISREG(details.st_mode)
                    or details.st_nlink != 1
                    or details.st_uid != owner
                    or details.st_mode & 0o077
                    or details.st_size > 131_072
                ):
                    raise PlatformError("unsafe_app_env")
                chunks: list[bytes] = []
                total = 0
                while True:
                    chunk = os.read(descriptor, 16_384)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > 131_072:
                        raise PlatformError("app_env_too_large")
                    chunks.append(chunk)
                return b"".join(chunks)
            finally:
                os.close(descriptor)
        finally:
            os.close(directory)

    @classmethod
    def _clean_current_env_temporaries(cls) -> None:
        directory = cls._open_app_directory(APP_CURRENT)
        try:
            cls._cleanup_env_temporaries(directory)
        finally:
            os.close(directory)

    @classmethod
    def _safe_env_write(cls, directory_path: Path, data: bytes) -> None:
        if len(data) > 131_072:
            raise PlatformError("app_env_too_large")
        directory = cls._open_app_directory(directory_path)
        owner, group = cls._codespace_identity()
        temporary = f".env.ops-{secrets.token_hex(8)}"
        flags = (
            os.O_CREAT
            | os.O_EXCL
            | os.O_WRONLY
            | getattr(os, "O_NOFOLLOW", 0)
            | getattr(os, "O_CLOEXEC", 0)
        )
        try:
            cls._cleanup_env_temporaries(directory)
            try:
                current = os.stat(".env", dir_fd=directory, follow_symlinks=False)
            except FileNotFoundError:
                current = None
            if current is not None and (
                not stat.S_ISREG(current.st_mode)
                or current.st_nlink != 1
                or current.st_uid != owner
                or current.st_mode & 0o077
            ):
                raise PlatformError("unsafe_app_env")
            descriptor = os.open(temporary, flags, 0o600, dir_fd=directory)
            try:
                os.fchown(descriptor, owner, group)
                view = memoryview(data)
                while view:
                    written = os.write(descriptor, view)
                    view = view[written:]
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            os.replace(
                temporary,
                ".env",
                src_dir_fd=directory,
                dst_dir_fd=directory,
            )
            os.fsync(directory)
        except Exception:
            try:
                os.unlink(temporary, dir_fd=directory)
            except FileNotFoundError:
                pass
            raise
        finally:
            os.close(directory)

    @staticmethod
    def _cleanup_env_temporaries(directory: int) -> None:
        removed = False
        for name in os.listdir(directory):
            if re.fullmatch(r"\.env\.ops-[0-9a-f]{16}", name) is None:
                continue
            details = os.stat(name, dir_fd=directory, follow_symlinks=False)
            if stat.S_ISDIR(details.st_mode):
                raise PlatformError("unsafe_env_temporary")
            os.unlink(name, dir_fd=directory)
            removed = True
        if removed:
            os.fsync(directory)

    @staticmethod
    def _write_private_backup(path: Path, data: bytes) -> None:
        if (
            path.parent != ROLLBACK_ROOT
            or not re.fullmatch(r"[0-9a-f-]{36}\.env", path.name)
            or len(data) > 131_072
        ):
            raise PlatformError("backup_target_not_allowlisted")
        flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0)
        descriptor = os.open(path, flags, 0o600)
        try:
            view = memoryview(data)
            while view:
                written = os.write(descriptor, view)
                view = view[written:]
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        directory = os.open(
            ROLLBACK_ROOT, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        )
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    @staticmethod
    def _read_private_backup(path: Path) -> bytes:
        if path.parent != ROLLBACK_ROOT or not re.fullmatch(r"[0-9a-f-]{36}\.env", path.name):
            raise PlatformError("backup_target_not_allowlisted")
        descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
        try:
            details = os.fstat(descriptor)
            if (
                not stat.S_ISREG(details.st_mode)
                or details.st_nlink != 1
                or details.st_uid != os.geteuid()
                or details.st_mode & 0o077
                or details.st_size > 131_072
            ):
                raise PlatformError("unsafe_backup")
            chunks: list[bytes] = []
            total = 0
            while True:
                chunk = os.read(descriptor, 16_384)
                if not chunk:
                    break
                total += len(chunk)
                if total > 131_072:
                    raise PlatformError("backup_too_large")
                chunks.append(chunk)
            return b"".join(chunks)
        finally:
            os.close(descriptor)

    @staticmethod
    def _remove_private_backup(path: Path) -> None:
        if path.parent != ROLLBACK_ROOT or not re.fullmatch(r"[0-9a-f-]{36}\.env", path.name):
            raise PlatformError("backup_target_not_allowlisted")
        path.unlink(missing_ok=True)
        directory = os.open(ROLLBACK_ROOT, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    def _release_manifest(self) -> dict[str, Any]:
        if not RELEASE_MANIFEST.exists():
            return {"phishtopia_app": {}, "phishtopia_ops": {}}
        value = json.loads(RELEASE_MANIFEST.read_text(encoding="utf8"))
        if not isinstance(value, dict):
            raise PlatformError("release_manifest_invalid")
        return value

    def _record_release(self, target: str, commit: str, digest: str) -> None:
        manifest = self._release_manifest()
        release_root = APP_RELEASES if target == "phishtopia_app" else OPS_RELEASES
        release = release_root / commit
        if (
            target not in {"phishtopia_app", "phishtopia_ops"}
            or re.fullmatch(r"[0-9a-f]{40}", commit) is None
            or not release.is_dir()
        ):
            raise PlatformError("release_record_not_allowlisted")
        manifest.setdefault(target, {})[commit] = {
            "sha256": digest,
            "treeSha256": self._tree_digest(release),
        }
        self._write_release_manifest(manifest)

    @staticmethod
    def _tree_digest(root: Path) -> str:
        digest = hashlib.sha256()
        for path in sorted(root.rglob("*")):
            relative = path.relative_to(root).as_posix()
            if relative == ".env":
                continue
            if re.fullmatch(r"\.env\.ops-[0-9a-f]{16}", path.name):
                raise PlatformError("release_contains_secret_temporary")
            details = path.lstat()
            digest.update(relative.encode())
            digest.update(b"\x00")
            digest.update(str(stat.S_IFMT(details.st_mode)).encode())
            digest.update(b"\x00")
            if stat.S_ISLNK(details.st_mode):
                digest.update(os.readlink(path).encode())
            elif stat.S_ISREG(details.st_mode):
                with path.open("rb") as handle:
                    while chunk := handle.read(1_048_576):
                        digest.update(chunk)
            elif not stat.S_ISDIR(details.st_mode):
                raise PlatformError("unsupported_release_entry")
            digest.update(b"\x00")
        return digest.hexdigest()

    def _restore_release_manifest(self, value: Any) -> None:
        if not isinstance(value, dict):
            raise PlatformError("release_manifest_baseline_missing")
        self._write_release_manifest(value)

    @staticmethod
    def _write_release_manifest(manifest: dict[str, Any]) -> None:
        if set(manifest) != {"phishtopia_app", "phishtopia_ops"} or any(
            not isinstance(manifest.get(key), dict)
            for key in ("phishtopia_app", "phishtopia_ops")
        ):
            raise PlatformError("release_manifest_invalid")
        temporary = STATE_ROOT / "releases.json.next"
        temporary.unlink(missing_ok=True)
        descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            os.write(descriptor, json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode())
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.replace(temporary, RELEASE_MANIFEST)
        directory = os.open(
            STATE_ROOT, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
        )
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    @staticmethod
    def _observations(*pairs: tuple[str, str]) -> list[dict[str, str]]:
        return [{"name": name, "value": value[:160]} for name, value in pairs[:12]]

    def _identity(self) -> None:
        output = self._run(
            [
                "/usr/bin/gcloud",
                "auth",
                "list",
                "--filter=status:ACTIVE",
                "--format=value(account)",
            ],
            timeout=20,
        ).decode().strip()
        if output != VM_SERVICE_ACCOUNT:
            raise PlatformError("unexpected_service_identity")
