from __future__ import annotations

import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
WORKFLOW = (ROOT / "../../.github/workflows/phishtopia-ops-controller.yml").resolve()


class ExternalControllerActivationTests(unittest.TestCase):
    def read(self, relative: str) -> str:
        return (ROOT / relative).read_text(encoding="utf-8")

    def test_workflow_pins_non_secret_identity_values(self) -> None:
        if not WORKFLOW.is_file():
            self.skipTest(
                "repository-level workflow is intentionally outside the packaged Ops release"
            )
        value = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("github.event.issue.number == 43", value)
        self.assertIn("github.actor_id == '123998606'", value)
        self.assertIn("projects/107649778409/locations/global/workloadIdentityPools/github-phishtopia-ops/providers/phishtopia-ops", value)
        self.assertIn("phishtopia-ops-controller@project-43a8be4b-69a7-4d52-805.iam.gserviceaccount.com", value)
        self.assertNotIn("vars.PHISHTOPIA_OPS_", value)

    def test_locked_queue_records_results_without_bot_comments(self) -> None:
        if not WORKFLOW.is_file():
            self.skipTest(
                "repository-level workflow is intentionally outside the packaged Ops release"
            )
        value = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("GITHUB_STEP_SUMMARY", value)
        self.assertIn("issues: read", value)
        self.assertNotIn("issues: write", value)
        self.assertNotIn('issues/$ISSUE/comments', value)

    def test_controller_installer_snapshots_and_verifies_rollback_state(self) -> None:
        value = self.read("scripts/install-bootstrap-with-controller.sh")
        for required in (
            "controller-unit.present",
            "controller-unit.absent",
            "controller-env.present",
            "controller-env.absent",
            "controller.enabled",
            "controller.active",
            "PHISHTOPIA_OPS_QUEUE_ISSUE=43",
            "systemctl enable --now phishtopia-ops-controller.service",
            "controller-installer-complete",
            "PHISHTOPIA_BOOTSTRAP_SELF_RECOVERY=1",
        ):
            self.assertIn(required, value)
        for forbidden in ("eval ", "bash -c", "sh -c", "curl ", "wget "):
            self.assertNotIn(forbidden, value)

    def test_recovery_restores_or_removes_controller_material(self) -> None:
        value = self.read("scripts/recover-bootstrap.sh")
        self.assertIn("controller-unit.present", value)
        self.assertIn("controller-env.present", value)
        self.assertIn('rm -f "$controller_unit"', value)
        self.assertIn('rm -f "$controller_env"', value)
        self.assertIn("systemctl restart phishtopia-ops-controller.service", value)

    def test_finalizer_requires_live_hardened_controller(self) -> None:
        value = self.read("scripts/finalize-bootstrap.sh")
        self.assertIn("controller-installer-complete", value)
        self.assertIn("systemctl is-active --quiet phishtopia-ops-controller.service", value)
        self.assertIn("root:root:600", value)
        self.assertIn("PHISHTOPIA_OPS_QUEUE_ISSUE=43", value)

    def test_cloud_shell_activator_is_fixed_and_commit_pinned(self) -> None:
        value = self.read("scripts/activate-external-controller-cloud-shell.sh")
        for required in (
            "project-43a8be4b-69a7-4d52-805",
            "us-east1-b",
            "phishtopia-vm",
            "PhishyOne/Phishtopia.com",
            "archive/$release.tar.gz",
            "sha256sum",
            "autonomous-bootstrap.sh",
            "external_controller_activation=success",
        ):
            self.assertIn(required, value)
        for forbidden in ("--force", "set-iam-policy", "secrets versions access", "database-url"):
            self.assertNotIn(forbidden, value)


if __name__ == "__main__":
    unittest.main()
