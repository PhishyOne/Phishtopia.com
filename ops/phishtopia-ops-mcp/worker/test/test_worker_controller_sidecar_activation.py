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
        self.assertIn('NRestarts --value', value)
        self.assertIn('worker_controller_failed_stage=', value)

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
