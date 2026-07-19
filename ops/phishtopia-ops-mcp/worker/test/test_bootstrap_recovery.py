from __future__ import annotations

import hashlib
import os
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[2]
RECOVER = PACKAGE_ROOT / "scripts" / "recover-bootstrap.sh"
ROLLBACK_LAST_GOOD = PACKAGE_ROOT / "scripts" / "rollback-bootstrap-last-good.sh"
INSTALL = PACKAGE_ROOT / "scripts" / "install-bootstrap.sh"
FINALIZE = PACKAGE_ROOT / "scripts" / "finalize-bootstrap.sh"
WORKER_UNIT = PACKAGE_ROOT / "systemd" / "phishtopia-ops-worker.service"
COMMIT = "a" * 40


class BootstrapRecoveryFakeTests(unittest.TestCase):
    def _write(self, path: Path, value: str) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(value, encoding="utf8")

    def _fake_commands(self, root: Path) -> tuple[dict[str, str], Path]:
        fake_bin = root / "fake-bin"
        fake_bin.mkdir(parents=True)
        log = root / "systemctl.log"
        self._write(
            fake_bin / "systemctl",
            f"#!/bin/sh\nprintf '%s\\n' \"$*\" >>'{log}'\nexit 0\n",
        )
        self._write(fake_bin / "id", "#!/bin/sh\necho 0\n")
        self._write(fake_bin / "userdel", "#!/bin/sh\nexit 0\n")
        self._write(fake_bin / "sudo", "#!/bin/sh\nexit 0\n")
        self._write(fake_bin / "setpriv", "#!/bin/sh\nexit 0\n")
        for path in fake_bin.iterdir():
            path.chmod(0o755)
        environment = dict(os.environ)
        environment["PATH"] = f"{fake_bin}:/usr/bin:/bin"
        return environment, log

    def _transformed(self, source: Path, root: Path) -> Path:
        value = source.read_text(encoding="utf8")
        for original, replacement in (
            ("/usr/bin/setpriv", str(root / "fake-bin/setpriv")),
            ("/var/lib", str(root / "var/lib")),
            ("/usr/local", str(root / "usr/local")),
            ("/opt", str(root / "opt")),
            ("/etc", str(root / "etc")),
            (
                "/run/phishtopia-ops-bootstrap.lock",
                str(root / "run/phishtopia-ops-bootstrap.lock"),
            ),
        ):
            value = value.replace(original, replacement)
        target = root / "transformed" / source.name
        self._write(target, value)
        target.chmod(0o755)
        return target

    def _baseline_state(self, root: Path) -> Path:
        state = root / "var/lib/phishtopia-ops-bootstrap-active"
        state.mkdir(parents=True)
        self._write(state / "release", COMMIT + "\n")
        self._write(state / "current.legacy", "")
        self._write(state / "current.old/source.txt", "baseline-source")
        self._write(state / "worker-dir.present", "")
        self._write(state / "worker.old/worker/daemon.py", "baseline-worker")
        self._write(state / "worker-unit.present", "")
        self._write(state / "worker.unit", "baseline-worker-unit")
        self._write(state / "tunnel.unit", "baseline-tunnel-unit")
        self._write(state / "worker.enabled", "disabled\n")
        self._write(state / "worker.active", "inactive\n")
        self._write(state / "tunnel.enabled", "enabled\n")
        self._write(state / "tunnel.active", "active\n")
        self._write(state / "manifest.absent", "")
        self._write(state / "worker-state.present", "")
        self._write(state / "worker-state.old/audit.jsonl", "baseline-audit")
        for marker in (
            "runtime.absent",
            "release-root.absent",
            "app-release-root.absent",
            "build-user.absent",
        ):
            self._write(state / marker, "")
        config = root / "etc/phishtopia-ops-mcp/tunnel.yaml"
        credential = root / "etc/credstore/phishtopia-ops-mcp/control-plane-api-key"
        launcher = root / "usr/local/libexec/phishtopia-ops-mcp-tunnel-launch"
        self._write(config, "fixed-tunnel")
        self._write(credential, "fixed-credential")
        self._write(launcher, "fixed-launcher")
        self._write(
            state / "tunnel-config.sha256",
            hashlib.sha256(config.read_bytes()).hexdigest() + "\n",
        )
        self._write(
            state / "tunnel-credential.sha256",
            hashlib.sha256(credential.read_bytes()).hexdigest() + "\n",
        )
        self._write(
            state / "tunnel-launcher.sha256",
            hashlib.sha256(launcher.read_bytes()).hexdigest() + "\n",
        )
        return state

    def test_recovery_restores_exact_disposable_baseline(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = self._baseline_state(root)
            self._write(root / "opt/phishtopia-ops-mcp/source.txt", "candidate")
            self._write(root / "usr/local/lib/phishtopia-ops-worker/worker/daemon.py", "candidate-worker")
            self._write(root / "etc/systemd/system/phishtopia-ops-worker.service", "candidate-worker-unit")
            self._write(root / "etc/systemd/system/phishtopia-ops-mcp-tunnel.service", "candidate-tunnel-unit")
            self._write(root / "var/lib/phishtopia-ops-worker/audit.jsonl", "candidate-audit")
            self._write(root / f"opt/phishtopia-ops-releases/{COMMIT}/candidate", "new")
            self._write(root / "opt/phishtopia-app-releases/new", "new")
            self._write(root / "opt/phishtopia-ops-runtime/node/bin/node", "new")
            self._write(root / "usr/local/libexec/phishtopia-ops-bootstrap-recover", "helper")
            self._write(root / "usr/local/sbin/phishtopia-ops-rollback-last-good", "helper")
            self._write(root / "etc/systemd/system/phishtopia-ops-bootstrap-recover.service", "unit")
            (root / "run").mkdir()
            environment, log = self._fake_commands(root)
            result = subprocess.run(
                ["/bin/sh", str(self._transformed(RECOVER, root))],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(
                (root / "opt/phishtopia-ops-mcp/source.txt").read_text(),
                "baseline-source",
            )
            self.assertEqual(
                (root / "usr/local/lib/phishtopia-ops-worker/worker/daemon.py").read_text(),
                "baseline-worker",
            )
            self.assertEqual(
                (root / "var/lib/phishtopia-ops-worker/audit.jsonl").read_text(),
                "baseline-audit",
            )
            self.assertEqual(
                (root / "etc/systemd/system/phishtopia-ops-worker.service").read_text(),
                "baseline-worker-unit",
            )
            self.assertEqual(
                (root / "etc/systemd/system/phishtopia-ops-mcp-tunnel.service").read_text(),
                "baseline-tunnel-unit",
            )
            self.assertFalse(state.exists())
            self.assertFalse(
                (root / "opt/phishtopia-ops-runtime").exists(), result.stderr
            )
            self.assertFalse((root / "opt/phishtopia-ops-releases").exists())
            self.assertFalse((root / "opt/phishtopia-app-releases").exists())
            self.assertIn("restart phishtopia-ops-mcp-tunnel.service", log.read_text())

    def test_recovery_waiter_cannot_delete_retained_last_good_helpers(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "var/lib/phishtopia-ops-bootstrap-last-good").mkdir(parents=True)
            helper = root / "usr/local/libexec/phishtopia-ops-bootstrap-recover"
            rollback = root / "usr/local/sbin/phishtopia-ops-rollback-last-good"
            self._write(helper, "helper")
            self._write(rollback, "rollback")
            (root / "run").mkdir()
            environment, _log = self._fake_commands(root)
            result = subprocess.run(
                ["/bin/sh", str(self._transformed(RECOVER, root))],
                env=environment,
                check=False,
            )
            self.assertEqual(result.returncode, 0)
            self.assertTrue(helper.exists())
            self.assertTrue(rollback.exists())

    def test_manual_last_good_rollback_rejects_active_durable_job(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "var/lib/phishtopia-ops-bootstrap-last-good").mkdir(parents=True)
            database = root / "var/lib/phishtopia-ops-worker/jobs.sqlite3"
            database.parent.mkdir(parents=True)
            with sqlite3.connect(database) as connection:
                connection.execute("CREATE TABLE jobs(state TEXT NOT NULL)")
                connection.execute("INSERT INTO jobs VALUES('running')")
            database.chmod(0o600)
            helper = root / "usr/local/libexec/phishtopia-ops-bootstrap-recover"
            self._write(helper, "#!/bin/sh\nexit 0\n")
            helper.chmod(0o755)
            (root / "run").mkdir()
            environment, _log = self._fake_commands(root)
            result = subprocess.run(
                ["/bin/sh", str(self._transformed(ROLLBACK_LAST_GOOD, root))],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("durable job history", result.stderr)
            self.assertTrue(
                (root / "var/lib/phishtopia-ops-bootstrap-last-good").is_dir()
            )
            self.assertFalse(
                (root / "var/lib/phishtopia-ops-worker-post-bootstrap-audit").exists()
            )

    def test_finalizer_atomically_retains_last_good_and_disables_auto_recovery(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "var/lib/phishtopia-ops-bootstrap-active"
            self._write(state / "installer-complete", "")
            config = root / "etc/phishtopia-ops-mcp/tunnel.yaml"
            credential = root / "etc/credstore/phishtopia-ops-mcp/control-plane-api-key"
            launcher = root / "usr/local/libexec/phishtopia-ops-mcp-tunnel-launch"
            self._write(config, "fixed-tunnel")
            self._write(credential, "fixed-credential")
            self._write(launcher, "fixed-launcher")
            self._write(
                state / "tunnel-config.sha256",
                hashlib.sha256(config.read_bytes()).hexdigest() + "\n",
            )
            self._write(
                state / "tunnel-credential.sha256",
                hashlib.sha256(credential.read_bytes()).hexdigest() + "\n",
            )
            self._write(
                state / "tunnel-launcher.sha256",
                hashlib.sha256(launcher.read_bytes()).hexdigest() + "\n",
            )
            node = root / "opt/phishtopia-ops-runtime/node/bin/node"
            self._write(node, "#!/bin/sh\nexit 0\n")
            node.chmod(0o755)
            self._write(
                root / "opt/phishtopia-ops-mcp/dist/smoke/worker-contract-smoke.js",
                "fake",
            )
            recovery = root / "usr/local/libexec/phishtopia-ops-bootstrap-recover"
            rollback = root / "usr/local/sbin/phishtopia-ops-rollback-last-good"
            unit = root / "etc/systemd/system/phishtopia-ops-bootstrap-recover.service"
            self._write(recovery, "helper")
            self._write(rollback, "rollback")
            self._write(unit, "unit")
            (root / "run").mkdir()
            environment, _log = self._fake_commands(root)
            result = subprocess.run(
                ["/bin/sh", str(self._transformed(FINALIZE, root))],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse(state.exists())
            self.assertTrue(
                (root / "var/lib/phishtopia-ops-bootstrap-last-good").is_dir()
            )
            self.assertTrue(recovery.exists())
            self.assertTrue(rollback.exists())
            self.assertFalse(unit.exists())

    def test_bootstrap_scripts_encode_bounded_exact_transaction_contract(self) -> None:
        install = INSTALL.read_text(encoding="utf8")
        recover = RECOVER.read_text(encoding="utf8")
        finalize = FINALIZE.read_text(encoding="utf8")
        self.assertNotIn("bootstrap-build-watchdog", install)
        self.assertNotIn("bootstrap-switch-watchdog", install)
        self.assertIn("RuntimeMaxSec=", install)
        self.assertIn("--setenv=PYTHONDONTWRITEBYTECODE=1", install)
        self.assertIn("sandbox /usr/bin/python3 -B -m unittest", install)
        self.assertIn("memory_available_kib", install)
        self.assertIn("disk_available", install)
        self.assertIn("phishtopia-cloudflare-dns-token", install)
        self.assertIn("worker-state.present", install)
        self.assertIn("worker-state.present", recover)
        self.assertIn("/usr/bin/flock 9", install)
        self.assertLess(
            install.index("/usr/bin/flock 9"), install.index("mkdir -m 0700")
        )
        self.assertIn("/usr/bin/flock -u 9", install)
        self.assertIn("/usr/bin/flock 9", recover)
        self.assertIn("/usr/bin/flock 9", finalize)
        self.assertIn("phishtopia-ops-bootstrap-last-good", finalize)
        self.assertIn("[ ! -L \"$current/.tools/node\" ]", install)
        self.assertIn("--no-preserve=ownership", install)
        self.assertIn("find \"$runtime/node\" -xdev -perm /022", install)
        retained = ROLLBACK_LAST_GOOD.read_text(encoding="utf8")
        self.assertIn("SELECT COUNT(*) FROM jobs", retained)
        self.assertIn("/opt/phishtopia-app-releases -mindepth 1", retained)

    def test_worker_runtime_cannot_write_bytecode_into_immutable_release(self) -> None:
        unit = WORKER_UNIT.read_text(encoding="utf8")
        self.assertIn("WorkingDirectory=/opt/phishtopia-ops-mcp", unit)
        self.assertIn("Environment=PYTHONDONTWRITEBYTECODE=1", unit)

    def test_term_and_hup_traps_recover_and_cannot_resume_install(self) -> None:
        install = INSTALL.read_text(encoding="utf8")
        start = install.index("rollback() {")
        end = install.index('install -m 0755 "$script_dir/recover-bootstrap.sh"')
        trap_contract = install[start:end]
        for signal_name, expected_status in (("TERM", 143), ("HUP", 129)):
            with self.subTest(signal=signal_name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                recovery = root / "recover"
                recovered = root / "recovered"
                resumed = root / "resumed"
                self._write(
                    recovery,
                    f"#!/bin/sh\nprintf recovered >'{recovered}'\nexit 0\n",
                )
                recovery.chmod(0o755)
                harness = root / "signal-harness.sh"
                self._write(
                    harness,
                    "#!/bin/sh\nset -eu\n"
                    f"recovery_helper='{recovery}'\nscript_dir='{root}'\n"
                    f"exec 9>'{root / 'lock'}'\n/usr/bin/flock 9\n"
                    + trap_contract
                    + f"kill -{signal_name} $$\nprintf resumed >'{resumed}'\n",
                )
                harness.chmod(0o755)
                result = subprocess.run(["/bin/sh", str(harness)], check=False)
                self.assertEqual(result.returncode, expected_status)
                self.assertTrue(recovered.is_file())
                self.assertFalse(resumed.exists())

    def test_manual_last_good_rollback_rejects_completed_job_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "var/lib/phishtopia-ops-bootstrap-last-good").mkdir(parents=True)
            database = root / "var/lib/phishtopia-ops-worker/jobs.sqlite3"
            database.parent.mkdir(parents=True)
            with sqlite3.connect(database) as connection:
                connection.execute("CREATE TABLE jobs(state TEXT NOT NULL)")
                connection.execute("INSERT INTO jobs VALUES('succeeded')")
            database.chmod(0o600)
            helper = root / "usr/local/libexec/phishtopia-ops-bootstrap-recover"
            self._write(helper, "#!/bin/sh\nexit 0\n")
            helper.chmod(0o755)
            (root / "run").mkdir()
            environment, _log = self._fake_commands(root)
            result = subprocess.run(
                ["/bin/sh", str(self._transformed(ROLLBACK_LAST_GOOD, root))],
                env=environment,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                check=False,
                text=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("durable job history", result.stderr)
            self.assertTrue(
                (root / "var/lib/phishtopia-ops-bootstrap-last-good").is_dir()
            )

    def test_bootstrap_lock_rejects_a_concurrent_transaction(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            lock = Path(directory) / "bootstrap.lock"
            descriptor = os.open(lock, os.O_CREAT | os.O_WRONLY, 0o600)
            try:
                subprocess.run(
                    ["/usr/bin/flock", "-x", str(descriptor)],
                    pass_fds=(descriptor,),
                    check=True,
                )
                contender = subprocess.run(
                    ["/usr/bin/flock", "-n", str(lock), "/bin/true"],
                    check=False,
                )
                self.assertNotEqual(contender.returncode, 0)
            finally:
                os.close(descriptor)
            self.assertEqual(
                subprocess.run(
                    ["/usr/bin/flock", "-n", str(lock), "/bin/true"],
                    check=False,
                ).returncode,
                0,
            )


if __name__ == "__main__":
    unittest.main()
