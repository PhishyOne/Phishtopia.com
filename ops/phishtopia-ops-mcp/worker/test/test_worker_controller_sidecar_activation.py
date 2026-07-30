from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
INSTALL = ROOT / "scripts/install-worker-controller-sidecar.sh"
ACTIVATE = ROOT / "scripts/activate-worker-controller-sidecar-cloud-shell.sh"
ROLLBACK = ROOT / "scripts/rollback-worker-controller-sidecar.sh"
WORKER_UNIT = ROOT / "systemd/phishtopia-ops-worker-standalone.service"


class WorkerControllerSidecarActivationTests(unittest.TestCase):
    def test_installer_leaves_existing_mcp_tunnel_untouched(self):
        value = INSTALL.read_text(encoding="utf8")
        self.assertIn('mcp_target_before=$(readlink -f "$mcp_current")', value)
        self.assertIn('tunnel_unit_before=$(sha256sum "$tunnel_unit"', value)
        self.assertIn('tunnel_launcher_before=$(sha256sum "$tunnel_launcher"', value)
        self.assertIn('systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service', value)
        self.assertNotIn('systemctl restart phishtopia-ops-mcp-tunnel.service', value)
        self.assertNotIn('systemctl stop phishtopia-ops-mcp-tunnel.service', value)
        self.assertNotIn('cp -a "$source_dir/systemd/phishtopia-ops-mcp-tunnel.service"', value)

    def test_installer_starts_only_new_worker_and_controller(self):
        value = INSTALL.read_text(encoding="utf8")
        self.assertIn('systemctl enable --now phishtopia-ops-worker.service', value)
        self.assertIn('systemctl enable --now phishtopia-ops-controller.service', value)
        self.assertIn('"operation": "get_contract"', value)
        self.assertIn('controller_error=', value)
        self.assertIn('restarts=$(service_property "$stable_unit" NRestarts)', value)
        self.assertIn('worker_controller_failed_stage=', value)

    def test_installer_fails_fast_with_bounded_service_diagnostics(self):
        value = INSTALL.read_text(encoding="utf8")
        for required in (
            "wait_for_worker_socket",
            "wait_for_controller_ready",
            "worker_readiness=service_failed",
            "worker_readiness=socket_timeout",
            "controller_readiness=transport_failed",
            "controller_readiness=transport_timeout",
            "controller_error_code=",
            "ActiveState",
            "SubState",
            "Result",
            "ExecMainCode",
            "ExecMainStatus",
            "NRestarts",
            "_SYSTEMD_INVOCATION_ID=",
        ):
            self.assertIn(required, value)
        self.assertIn('stage=wait_worker_socket', value)
        self.assertIn('stage=verify_worker_contract', value)
        self.assertIn('stage=wait_controller_transport', value)
        self.assertIn('while [ "$attempts" -le 15 ]', value)
        self.assertIn('while [ "$attempts" -le 30 ]', value)
        self.assertNotIn("sleep 23", value)
        self.assertNotIn("journalctl -u", value)

    def test_installer_rechecks_stability_before_commit(self):
        value = INSTALL.read_text(encoding="utf8")
        self.assertIn("verify_service_stable()", value)
        self.assertEqual(
            value.count(
                'verify_service_stable worker phishtopia-ops-worker.service "$worker_invocation"'
            ),
            2,
        )
        self.assertIn(
            'verify_service_stable controller phishtopia-ops-controller.service "$controller_invocation"',
            value,
        )
        final = value.index("stage=final_verification")
        commit = value.index("stage=commit")
        final_block = value[final:commit]
        self.assertIn("controller_error=", final_block)
        helper = value[value.index("verify_service_stable()"):value.index("invocation_log_has()")]
        self.assertIn("InvocationID", helper)
        self.assertIn('"$restarts" != 0', helper)

    def test_daemons_emit_only_fixed_startup_readiness_markers(self):
        worker = (ROOT / "worker/daemon.py").read_text(encoding="utf8")
        controller = (ROOT / "controller/relay_daemon.py").read_text(encoding="utf8")
        self.assertIn('print(f"worker_error_stage={stage}"', worker)
        self.assertIn('"controller_ready=1"', controller)
        main = controller[controller.index("def main()"):]
        self.assertLess(
            main.index("client.verify_transport()"),
            main.index('print("controller_ready=1"'),
        )
        self.assertLess(
            main.index('print("controller_ready=1"'),
            main.index("handled = run_once"),
        )

    def test_worker_unit_uses_standalone_immutable_path(self):
        value = WORKER_UNIT.read_text(encoding="utf8")
        self.assertIn('WorkingDirectory=/opt/phishtopia-ops-worker-code', value)
        self.assertIn('Environment=PYTHONPATH=/opt/phishtopia-ops-worker-code', value)
        self.assertIn('ExecStart=/usr/bin/python3 -m worker.daemon', value)
        self.assertNotIn('WorkingDirectory=/opt/phishtopia-ops-mcp', value)

    def test_cloud_shell_package_is_bounded(self):
        value = ACTIVATE.read_text(encoding="utf8")
        for required in (
            '"worker/daemon.py"',
            '"worker/platform.py"',
            '"controller/relay_daemon.py"',
            '"systemd/phishtopia-ops-worker-standalone.service"',
            '"scripts/install-worker-controller-sidecar.sh"',
        ):
            self.assertIn(required, value)
        self.assertIn('path.parts[0] not in {"worker", "controller", "systemd", "scripts"}', value)
        self.assertNotIn('ops/phishtopia-ops-mcp/src', value)

    def test_rollback_is_sidecar_scoped(self):
        value = ROLLBACK.read_text(encoding="utf8")
        self.assertIn('phishtopia-ops-worker-controller-last-good', value)
        self.assertIn('systemctl stop phishtopia-ops-controller.service phishtopia-ops-worker.service', value)
        self.assertIn('systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service', value)
        self.assertNotIn('systemctl stop phishtopia-ops-mcp-tunnel.service', value)
        self.assertNotIn('/opt/phishtopia-ops-mcp"', value)


if __name__ == "__main__":
    unittest.main()
