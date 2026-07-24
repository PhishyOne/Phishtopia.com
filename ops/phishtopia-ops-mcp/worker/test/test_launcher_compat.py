from __future__ import annotations

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "scripts" / "run-install-bootstrap-with-launcher-compat.sh"
CONTROLLER_INSTALLER = ROOT / "scripts" / "install-bootstrap-with-controller.sh"


class LauncherCompatibilityTests(unittest.TestCase):
    def test_compatibility_patch_is_exact_and_fail_closed(self) -> None:
        value = HELPER.read_text(encoding="utf-8")
        for required in (
            "a38d6ef8c340000d88fb9eb7c598f808b3196ebcf7141fa9b9eb9951784b4d01",
            "7bf704d26b6978e667dae089f785cab9822f16bcf22ff1db55c6585ce72f26f7",
            "a71f4f6b166d12ea41c7625e022d325cb5b8f7dd66131a5196e63fa061a0662c",
            "00b18260ac1e87b3c57ce8743fcfe9bc401f296f508fb47e4180bb9c13b640ea",
            "value.count(old) != 1",
            "fixed launcher guard not found exactly once",
            "tunnel launcher transition rejected",
        ):
            self.assertIn(required, value)
        for forbidden in ("eval ", "curl ", "wget ", "--force"):
            self.assertNotIn(forbidden, value)

    def test_controller_installer_cleans_only_fixed_dangling_unit(self) -> None:
        value = CONTROLLER_INSTALLER.read_text(encoding="utf-8")
        self.assertIn("run-install-bootstrap-with-launcher-compat.sh", value)
        self.assertIn(
            "/etc/systemd/system/multi-user.target.wants/phishtopia-ops-controller.service",
            value,
        )
        self.assertIn("systemctl disable phishtopia-ops-controller.service", value)
        self.assertNotIn("systemctl disable --now '*'", value)


if __name__ == "__main__":
    unittest.main()
