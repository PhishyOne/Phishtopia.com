from __future__ import annotations

import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import worker.platform as platform_module
from worker.platform import DEPLOY_LOG_TAIL_BYTES, RealPlatform


class ReleaseStatusTests(unittest.TestCase):
    def setUp(self) -> None:
        self.commit = "a" * 40

    def _status(
        self,
        root: Path,
        log: Path,
        *,
        active_commit: str | None = None,
    ) -> dict[str, object]:
        releases = root / "releases"
        releases.mkdir(exist_ok=True)
        commit = active_commit or self.commit
        release = releases / commit
        release.mkdir(exist_ok=True)
        current = root / "current"
        current.symlink_to(release)
        platform = RealPlatform.__new__(RealPlatform)
        with (
            mock.patch.object(platform_module, "APP_CURRENT", current),
            mock.patch.object(platform_module, "APP_RELEASES", releases),
            mock.patch.object(platform_module, "APP_DEPLOY_LOG", log),
            mock.patch.object(
                platform_module.pwd,
                "getpwnam",
                return_value=SimpleNamespace(pw_uid=os.getuid()),
            ),
        ):
            return platform.release_status()

    @staticmethod
    def _observations(result: dict[str, object]) -> dict[str, str]:
        return {
            str(item["name"]): str(item["value"])
            for item in result["observations"]  # type: ignore[union-attr]
        }

    def test_exact_release_and_bounded_log_commit_match(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / "deploy.log"
            log.write_text(
                "starting deployment\n"
                f"deployed commit {self.commit}\n"
                "health passed\n"
            )
            log.chmod(0o600)

            result = self._status(root, log)
            observations = self._observations(result)

            self.assertEqual(result["status"], "ok")
            self.assertEqual(observations["deployed_commit"], self.commit)
            self.assertEqual(observations["release_source"], "verified_release")
            self.assertEqual(observations["deployment_log_status"], "matched")
            self.assertEqual(observations["last_logged_commit"], self.commit)
            self.assertEqual(observations["commit_matches_log"], "true")
            self.assertRegex(
                observations["deployment_log_updated_at"],
                r"^\d{4}-\d{2}-\d{2}T",
            )

    def test_mismatched_log_is_degraded_without_returning_raw_content(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / "deploy.log"
            hostile = (
                "https://private.example token=super-secret "
                + "b" * 40
                + "\n"
            )
            log.write_text(hostile)
            log.chmod(0o600)

            result = self._status(root, log)
            encoded = repr(result)
            observations = self._observations(result)

            self.assertEqual(result["status"], "degraded")
            self.assertEqual(observations["deployment_log_status"], "mismatch")
            self.assertEqual(observations["last_logged_commit"], "b" * 40)
            self.assertEqual(observations["commit_matches_log"], "false")
            self.assertNotIn("private.example", encoded)
            self.assertNotIn("super-secret", encoded)

    def test_symlinked_or_writable_log_fails_closed(self) -> None:
        for unsafe_kind in ("symlink", "writable"):
            with self.subTest(unsafe_kind=unsafe_kind):
                with tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    target = root / "target.log"
                    target.write_text(self.commit + "\n")
                    target.chmod(0o600)
                    log = root / "deploy.log"
                    if unsafe_kind == "symlink":
                        log.symlink_to(target)
                    else:
                        log.write_text(self.commit + "\n")
                        log.chmod(0o622)

                    result = self._status(root, log)
                    observations = self._observations(result)

                    self.assertEqual(result["status"], "degraded")
                    self.assertEqual(
                        observations["deployment_log_status"], "unsafe"
                    )
                    self.assertEqual(observations["last_logged_commit"], "unknown")

    def test_only_the_fixed_tail_is_read(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / "deploy.log"
            log.write_bytes(
                b"x" * (DEPLOY_LOG_TAIL_BYTES + 4096)
                + b"\n"
                + self.commit.encode("ascii")
                + b"\n"
            )
            log.chmod(0o600)

            result = self._status(root, log)
            observations = self._observations(result)

            self.assertEqual(result["status"], "ok")
            self.assertLessEqual(
                int(observations["bounded_tail_bytes"]),
                DEPLOY_LOG_TAIL_BYTES,
            )

    def test_missing_log_preserves_release_identity_but_is_degraded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            result = self._status(root, root / "missing.log")
            observations = self._observations(result)

            self.assertEqual(result["status"], "degraded")
            self.assertEqual(observations["deployed_commit"], self.commit)
            self.assertEqual(
                observations["deployment_log_status"], "unavailable"
            )

    def test_release_symlink_must_target_a_directory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            releases = root / "releases"
            releases.mkdir()
            release = releases / self.commit
            release.write_text("not a release directory")
            current = root / "current"
            current.symlink_to(release)
            platform = RealPlatform.__new__(RealPlatform)
            with (
                mock.patch.object(platform_module, "APP_CURRENT", current),
                mock.patch.object(platform_module, "APP_RELEASES", releases),
            ):
                result = platform.release_status()

            self.assertEqual(result["status"], "unavailable")

    def test_legacy_git_checkout_reports_exact_head(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            checkout = Path(directory) / "checkout"
            checkout.mkdir()
            subprocess.run(
                ["/usr/bin/git", "init", "-q", str(checkout)],
                check=True,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            subprocess.run(
                [
                    "/usr/bin/git", "-C", str(checkout), "config",
                    "user.email", "test@example.invalid",
                ],
                check=True,
            )
            subprocess.run(
                ["/usr/bin/git", "-C", str(checkout), "config", "user.name", "Test"],
                check=True,
            )
            (checkout / "README").write_text("release\n")
            subprocess.run(
                ["/usr/bin/git", "-C", str(checkout), "add", "README"],
                check=True,
            )
            subprocess.run(
                [
                    "/usr/bin/git", "-C", str(checkout),
                    "-c", "commit.gpgsign=false", "commit", "-q", "-m", "release",
                ],
                check=True,
            )
            expected = subprocess.run(
                ["/usr/bin/git", "-C", str(checkout), "rev-parse", "HEAD"],
                check=True,
                stdout=subprocess.PIPE,
                text=True,
            ).stdout.strip()
            releases = Path(directory) / "releases"
            releases.mkdir()
            with (
                mock.patch.object(platform_module, "APP_CURRENT", checkout),
                mock.patch.object(platform_module, "APP_RELEASES", releases),
            ):
                commit, source = RealPlatform._checkout_commit(checkout)

            self.assertEqual(commit, expected)
            self.assertEqual(source, "git_checkout")


if __name__ == "__main__":
    unittest.main()
