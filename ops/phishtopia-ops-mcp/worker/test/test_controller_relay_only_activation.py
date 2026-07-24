from __future__ import annotations

import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
INSTALLER = ROOT / "scripts/install-controller-relay-only.sh"
ROLLBACK = ROOT / "scripts/rollback-controller-relay-only.sh"
ACTIVATOR = ROOT / "scripts/activate-controller-relay-only-cloud-shell.sh"
SERVICE = ROOT / "systemd/phishtopia-ops-controller-standalone.service"


class ControllerRelayOnlyActivationTests(unittest.TestCase):
    def test_service_runs_from_dedicated_controller_release(self) -> None:
        value = SERVICE.read_text(encoding="utf-8")
        self.assertIn("WorkingDirectory=/opt/phishtopia-ops-controller", value)
        self.assertIn("Environment=PYTHONPATH=/opt/phishtopia-ops-controller", value)
        self.assertIn("User=phishtopia-mcp", value)
        self.assertIn("Requires=phishtopia-ops-worker.service", value)
        self.assertNotIn("/opt/phishtopia-ops-mcp", value)

    def test_installer_preserves_existing_worker_and_tunnel(self) -> None:
        value = INSTALLER.read_text(encoding="utf-8")
        for required in (
            "mcp_target_before=$(readlink -f",
            "worker_unit_before=$(sha256sum",
            "tunnel_unit_before=$(sha256sum",
            "tunnel_launcher_before=$(sha256sum",
            'root:phishtopia-mcp:660',
            "systemctl is-active --quiet phishtopia-ops-worker.service",
            "systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service",
            "/opt/phishtopia-ops-controller-releases",
            "/var/lib/phishtopia-ops-controller-last-good",
            "controller_error=",
        ):
            self.assertIn(required, value)
        for forbidden in (
            "systemctl restart phishtopia-ops-worker.service",
            "systemctl restart phishtopia-ops-mcp-tunnel.service",
            'rm -rf "$mcp_current"',
            'rm -f "$worker_unit"',
            'rm -f "$tunnel_unit"',
            "secrets versions access",
            "database-url",
        ):
            self.assertNotIn(forbidden, value)

    def test_activator_packages_only_relay_runtime_and_validator(self) -> None:
        value = ACTIVATOR.read_text(encoding="utf-8")
        for required in (
            '"controller/relay_daemon.py"',
            '"controller/pubsub_rest.py"',
            '"worker/allowlist.py"',
            '"scripts/install-controller-relay-only.sh"',
            '"scripts/rollback-controller-relay-only.sh"',
            '"systemd/phishtopia-ops-controller-standalone.service"',
            "controller package contents rejected",
            "PHISHTOPIA_OPS_CONTROLLER_RELAY=success",
        ):
            self.assertIn(required, value)
        for forbidden in (
            "npm ci",
            "autonomous-bootstrap.sh",
            "install-bootstrap-with-controller.sh",
            "phishtopia-ops-mcp-tunnel.service",
            "phishtopia-ops-worker.service",
        ):
            self.assertNotIn(forbidden, value)

    def test_rollback_restores_controller_only_and_rechecks_baseline(self) -> None:
        value = ROLLBACK.read_text(encoding="utf-8")
        self.assertIn("controller_relay_rollback=success", value)
        self.assertIn("worker-unit.sha256", value)
        self.assertIn("tunnel-unit.sha256", value)
        self.assertIn("tunnel-launcher.sha256", value)
        self.assertIn("systemctl is-active --quiet phishtopia-ops-worker.service", value)
        self.assertIn("systemctl is-active --quiet phishtopia-ops-mcp-tunnel.service", value)
        self.assertNotIn("systemctl restart phishtopia-ops-worker.service", value)
        self.assertNotIn("systemctl restart phishtopia-ops-mcp-tunnel.service", value)


if __name__ == "__main__":
    unittest.main()
