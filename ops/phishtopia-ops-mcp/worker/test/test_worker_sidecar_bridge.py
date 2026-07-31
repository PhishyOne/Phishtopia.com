from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
CLOUD = ROOT / "scripts/bridge-worker-sidecar-cloud-shell.sh"
INSTALL = ROOT / "scripts/install-worker-sidecar-bridge.sh"
ROLLBACK = ROOT / "scripts/rollback-worker-sidecar-bridge.sh"


class WorkerSidecarBridgeTests(unittest.TestCase):
    def test_cloud_shell_entrypoint_requires_immutable_inputs(self) -> None:
        value = CLOUD.read_text(encoding="utf8")
        self.assertIn("MERGED_COMMIT REPOSITORY_ARCHIVE_SHA256", value)
        self.assertIn('[ "${#release}" -eq 40 ]', value)
        self.assertIn('[ "${#repository_digest}" -eq 64 ]', value)
        self.assertIn(
            '[ "$(sha256sum "$archive" | cut -d\' \' -f1)" = "$repository_digest" ]',
            value,
        )
        self.assertIn("https://github.com/$REPOSITORY/archive/$release.tar.gz", value)
        self.assertNotIn("refs/heads/", value)
        self.assertNotIn("/archive/main", value)

    def test_bridge_package_is_full_bounded_ops_source(self) -> None:
        value = CLOUD.read_text(encoding="utf8")
        for required in (
            'source / "package-lock.json"',
            'source / "worker" / "platform.py"',
            '"ops/systemd/phishtopia-ops-worker-standalone.service"',
            '"ops/scripts/install-worker-sidecar-bridge.sh"',
            '"ops/scripts/rollback-worker-sidecar-bridge.sh"',
        ):
            self.assertIn(required, value)
        self.assertIn("not 1 <= len(members) <= 512", value)
        self.assertIn("worker bridge package size rejected", value)
        self.assertGreaterEqual(value.count("path.as_posix() in seen"), 2)
        self.assertIn("member.issym()", value)
        self.assertIn("member.islnk()", value)
        self.assertIn('path.parts[0] != "ops"', value)

    def test_unit_bridge_allows_exactly_one_nginx_log_directory(self) -> None:
        value = INSTALL.read_text(encoding="utf8")
        self.assertIn('allowance = b" -/var/log/nginx"', value)
        self.assertIn("installed.count(allowance) != 0", value)
        self.assertIn("candidate.count(allowance) != 1", value)
        self.assertIn('candidate.replace(allowance, b"", 1) != installed', value)
        self.assertIn('if "/var/log" in line.split()', value)
        self.assertIn('"-/var/log/nginx" not in line.split()', value)
        self.assertIn("worker bridge unit delta rejected", value)

    def test_bridge_refuses_jobs_and_pending_reexec(self) -> None:
        install = INSTALL.read_text(encoding="utf8")
        rollback = ROLLBACK.read_text(encoding="utf8")
        active_query = "WHERE state IN ('queued','running','cancelling')"
        self.assertGreaterEqual(install.count(active_query), 1)
        self.assertIn(active_query, rollback)
        self.assertGreaterEqual(install.count("assert_no_active_jobs"), 4)
        self.assertIn('[ ! -e "$reexec_flag" ]', install)

    def test_bridge_changes_only_worker_sidecar(self) -> None:
        value = INSTALL.read_text(encoding="utf8")
        self.assertIn("systemctl stop phishtopia-ops-worker.service", value)
        self.assertIn('mv -Tf "$worker_current.next" "$worker_current"', value)
        self.assertNotIn("systemctl stop phishtopia-ops-controller.service", value)
        self.assertNotIn("systemctl restart phishtopia-ops-controller.service", value)
        self.assertNotIn("systemctl stop phishtopia-ops-mcp-tunnel.service", value)
        self.assertNotIn("systemctl restart phishtopia-ops-mcp-tunnel.service", value)
        self.assertIn('[ "$(readlink -f "$mcp_current")" = "$mcp_target" ]', value)
        self.assertIn("tunnel_unit_digest", value)
        self.assertIn("tunnel_launcher_digest", value)

    def test_bridge_has_pre_mutation_tests_and_health_gates(self) -> None:
        value = INSTALL.read_text(encoding="utf8")
        self.assertLess(value.index("stage=worker_tests"), value.index("stage=install_worker"))
        self.assertLess(
            value.index("stage=mutation_preflight"),
            value.index("stage=install_worker"),
        )
        self.assertGreaterEqual(value.count("nginx_sandbox_test"), 3)
        self.assertGreaterEqual(value.count("public_health"), 4)
        self.assertIn("-m unittest discover", value)
        self.assertIn("verify_worker_contract", value)

    def test_bridge_snapshots_and_restores_unit_pointer_and_manifest(self) -> None:
        value = INSTALL.read_text(encoding="utf8")
        for required in (
            'cp -a "$worker_unit" "$state_next/worker.unit"',
            '"$state_next/worker-current.target"',
            '"$state_next/releases.json"',
            'install -o root -g root -m 0644 "$state/worker.unit" "$worker_unit"',
            'ln -s "$(sed -n \'1p\' "$state/worker-current.target")" "$worker_current"',
            'install -o root -g root -m 0600 "$state/releases.json" "$release_manifest"',
            "worker_bridge_rollback=success",
            "worker_bridge_rollback=failed",
            "worker_bridge_recovery_state=preserved",
        ):
            self.assertIn(required, value)
        self.assertIn('manifest["phishtopia_ops"] = {}', value)
        self.assertIn(
            'platform._record_release("phishtopia_ops", release, digest)',
            value,
        )

    def test_manual_rollback_is_current_release_guarded(self) -> None:
        value = ROLLBACK.read_text(encoding="utf8")
        self.assertIn(
            'current_target=$(readlink -f "$worker_current")',
            value,
        )
        self.assertIn('[ "$current_target" != "$candidate" ]', value)
        self.assertIn('[ "$current_target" != "$previous_target" ]', value)
        self.assertIn("worker bridge release is no longer current", value)
        self.assertIn('install -o root -g root -m 0644 "$state/worker.unit"', value)
        self.assertIn('systemctl is-active --quiet phishtopia-ops-controller.service', value)
        self.assertIn('systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service', value)
        self.assertLess(value.index('rm -rf "$candidate"'), value.index('rm -rf "$state"'))


if __name__ == "__main__":
    unittest.main()
