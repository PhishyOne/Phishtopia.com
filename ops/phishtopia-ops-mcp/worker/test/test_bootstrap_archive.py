from __future__ import annotations

import hashlib
import importlib.util
import io
import stat
import tarfile
import tempfile
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[2]
VERIFIER = PACKAGE_ROOT / "scripts" / "verify-bootstrap-archive.py"
SPEC = importlib.util.spec_from_file_location("bootstrap_archive_verifier", VERIFIER)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("bootstrap archive verifier could not be loaded")
VERIFIER_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER_MODULE)


def add_directory(bundle: tarfile.TarFile, name: str, mode: int = 0o777) -> None:
    member = tarfile.TarInfo(name)
    member.type = tarfile.DIRTYPE
    member.mode = mode
    bundle.addfile(member)


def add_file(
    bundle: tarfile.TarFile,
    name: str,
    content: bytes,
    mode: int = 0o666,
) -> None:
    member = tarfile.TarInfo(name)
    member.size = len(content)
    member.mode = mode
    bundle.addfile(member, io.BytesIO(content))


class BootstrapArchiveVerifierTests(unittest.TestCase):
    def test_controlled_extractor_is_python311_compatible_and_sanitizes_modes(
        self,
    ) -> None:
        self.assertNotIn("extractall(", VERIFIER.read_text(encoding="utf8"))

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "source.tar.gz"
            destination = root / "extract"
            destination.mkdir(mode=0o700)

            with tarfile.open(archive, "w:gz") as bundle:
                add_directory(bundle, "repo", 0o777)
                add_directory(bundle, "repo/bin", 0o777)
                add_file(bundle, "repo/bin/tool", b"#!/bin/sh\nexit 0\n", 0o777)
                add_file(bundle, "repo/data.txt", b"data", 0o666)

            with tarfile.open(archive, "r:gz") as bundle:
                VERIFIER_MODULE.extract_sanitized(
                    bundle,
                    bundle.getmembers(),
                    destination,
                )

            self.assertEqual((destination / "repo/data.txt").read_bytes(), b"data")
            self.assertEqual(
                stat.S_IMODE((destination / "repo").stat().st_mode),
                0o700,
            )
            self.assertEqual(
                stat.S_IMODE((destination / "repo/bin/tool").stat().st_mode),
                0o700,
            )
            self.assertEqual(
                stat.S_IMODE((destination / "repo/data.txt").stat().st_mode),
                0o600,
            )

    def test_archive_member_policy_rejects_unsafe_or_unsupported_entries(
        self,
    ) -> None:
        entries: list[tarfile.TarInfo] = []

        traversal = tarfile.TarInfo("../escape")
        entries.append(traversal)

        absolute = tarfile.TarInfo("/escape")
        entries.append(absolute)

        symlink = tarfile.TarInfo("repo/link")
        symlink.type = tarfile.SYMTYPE
        symlink.linkname = "target"
        entries.append(symlink)

        hardlink = tarfile.TarInfo("repo/hardlink")
        hardlink.type = tarfile.LNKTYPE
        hardlink.linkname = "repo/file"
        entries.append(hardlink)

        fifo = tarfile.TarInfo("repo/fifo")
        fifo.type = tarfile.FIFOTYPE
        entries.append(fifo)

        unsupported = tarfile.TarInfo("repo/unsupported")
        unsupported.type = tarfile.XHDTYPE
        entries.append(unsupported)

        for member in entries:
            with self.subTest(name=member.name, type=member.type):
                with self.assertRaises(SystemExit):
                    VERIFIER_MODULE._member_parts(member)

    def test_controlled_extractor_rejects_duplicate_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "duplicate.tar.gz"
            destination = root / "extract"
            destination.mkdir(mode=0o700)

            with tarfile.open(archive, "w:gz") as bundle:
                add_file(bundle, "repo/file.txt", b"first")
                add_file(bundle, "repo/file.txt", b"second")

            with tarfile.open(archive, "r:gz") as bundle:
                with self.assertRaises(SystemExit):
                    VERIFIER_MODULE.extract_sanitized(
                        bundle,
                        bundle.getmembers(),
                        destination,
                    )

    def test_exact_copy_rejects_truncated_or_oversized_content(self) -> None:
        with self.assertRaises(SystemExit):
            VERIFIER_MODULE._copy_exact(io.BytesIO(b"short"), io.BytesIO(), 6)
        with self.assertRaises(SystemExit):
            VERIFIER_MODULE._copy_exact(io.BytesIO(b"longer"), io.BytesIO(), 3)

    def test_full_verifier_accepts_minimal_safe_archive_without_filter_api(
        self,
    ) -> None:
        commit = "a" * 40
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            input_root = root / "input"
            release_root = root / "releases"
            input_root.mkdir()
            release_root.mkdir()
            archive = input_root / f"{commit}.tar.gz"
            destination = release_root / f".staging-{commit}"
            repository = f"Phishtopia.com-{commit}"

            with tarfile.open(archive, "w:gz") as bundle:
                for name in (
                    repository,
                    f"{repository}/ops",
                    f"{repository}/ops/phishtopia-ops-mcp",
                    f"{repository}/ops/phishtopia-ops-mcp/src",
                    f"{repository}/ops/phishtopia-ops-mcp/worker",
                    f"{repository}/ops/phishtopia-ops-mcp/systemd",
                ):
                    add_directory(bundle, name)
                add_file(
                    bundle,
                    f"{repository}/ops/phishtopia-ops-mcp/package.json",
                    b"{}",
                )
                add_file(
                    bundle,
                    f"{repository}/ops/phishtopia-ops-mcp/package-lock.json",
                    b'{"lockfileVersion":3,"packages":{}}',
                )
                add_file(
                    bundle,
                    f"{repository}/ops/phishtopia-ops-mcp/tsconfig.json",
                    b"{}",
                )
                add_file(
                    bundle,
                    f"{repository}/ops/phishtopia-ops-mcp/src/index.ts",
                    b"export {};\n",
                )
                add_file(
                    bundle,
                    f"{repository}/ops/phishtopia-ops-mcp/worker/daemon.py",
                    b"pass\n",
                )
                add_file(
                    bundle,
                    f"{repository}/ops/phishtopia-ops-mcp/systemd/unit.service",
                    b"[Service]\n",
                )

            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            VERIFIER_MODULE.verify_archive(
                archive,
                destination,
                commit,
                digest,
                input_root=input_root,
                release_root=release_root,
            )

            self.assertEqual(
                (destination / "src/index.ts").read_text(encoding="utf8"),
                "export {};\n",
            )
            self.assertFalse(
                destination.with_name(f".extract-{commit}").exists()
            )


if __name__ == "__main__":
    unittest.main()
