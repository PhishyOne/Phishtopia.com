#!/usr/bin/python3
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
import tarfile
from pathlib import Path


def fail(message: str) -> None:
    raise SystemExit(message)


if len(sys.argv) != 5:
    fail("usage: verify-bootstrap-archive.py ARCHIVE DESTINATION COMMIT SHA256")

archive, destination = Path(sys.argv[1]), Path(sys.argv[2])
commit, expected = sys.argv[3], sys.argv[4]
input_root = Path("/var/lib/phishtopia-ops-bootstrap-input")
release_root = Path("/opt/phishtopia-ops-releases")
if (
    archive.parent != input_root
    or archive.name != f"{commit}.tar.gz"
    or destination.parent != release_root
    or destination.name != f".staging-{commit}"
    or re.fullmatch(r"[0-9a-f]{40}", commit) is None
    or re.fullmatch(r"[0-9a-f]{64}", expected) is None
):
    fail("bootstrap path or digest is not allowlisted")

digest = hashlib.sha256()
with archive.open("rb") as source:
    while chunk := source.read(1_048_576):
        digest.update(chunk)
if digest.hexdigest() != expected:
    fail("bootstrap archive digest mismatch")
if destination.exists() or destination.is_symlink():
    fail("bootstrap staging destination already exists")

extract = destination.with_name(f".extract-{commit}")
shutil.rmtree(extract, ignore_errors=True)
extract.mkdir(mode=0o700)
try:
    with tarfile.open(archive, "r:gz") as bundle:
        members = bundle.getmembers()
        if not 1 <= len(members) <= 30_000:
            fail("bootstrap archive file count rejected")
        total = 0
        for member in members:
            parts = Path(member.name).parts
            if (
                not parts
                or ".." in parts
                or member.isdev()
                or member.issym()
                or member.islnk()
                or member.size > 100_000_000
            ):
                fail("bootstrap archive entry rejected")
            total += member.size
            if total > 750_000_000:
                fail("bootstrap archive expansion quota exceeded")
        if shutil.disk_usage(extract).free < total + 1_000_000_000:
            fail("bootstrap disk reserve rejected")
        bundle.extractall(extract, filter="data")
    roots = [item for item in extract.iterdir() if item.is_dir()]
    if len(roots) != 1:
        fail("bootstrap archive root rejected")
    source = roots[0] / "ops" / "phishtopia-ops-mcp"
    required = {
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "src",
        "worker",
        "systemd",
    }
    if not source.is_dir() or not required <= {item.name for item in source.iterdir()}:
        fail("bootstrap ops source missing")
    forbidden_names = {
        ".env",
        ".npmrc",
        "credentials.json",
        "service-account.json",
        "tunnel.yaml",
        "control-plane-api-key",
    }
    secret_patterns = (
        re.compile(rb"-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----"),
        re.compile(rb'"type"\s*:\s*"service_account"'),
        re.compile(rb'"private_key"\s*:'),
        re.compile(rb"(?i)(?:password|api[_-]?key|credential|secret[_-]?key)\s*[=:]\s*['\"]?[A-Za-z0-9+/=_-]{24,}"),
    )
    for path in source.rglob("*"):
        relative = path.relative_to(source)
        if any(part in {"node_modules", ".git", "dist", "logs", "state"} for part in relative.parts):
            fail("bootstrap runtime path rejected")
        if path.name in forbidden_names or path.name.endswith((".pem", ".key", ".sqlite", ".sqlite3", ".log")):
            fail("bootstrap credential or runtime filename rejected")
        if path.is_file() and path.stat().st_size <= 2_000_000:
            data = path.read_bytes()
            if any(pattern.search(data) for pattern in secret_patterns):
                fail("bootstrap secret-like value rejected")
    lock = json.loads((source / "package-lock.json").read_text(encoding="utf8"))
    packages = lock.get("packages") if isinstance(lock, dict) else None
    if lock.get("lockfileVersion") != 3 or not isinstance(packages, dict):
        fail("bootstrap package lock rejected")
    for metadata in packages.values():
        if not isinstance(metadata, dict):
            fail("bootstrap package lock rejected")
        resolved = metadata.get("resolved")
        if resolved is not None and (
            not isinstance(resolved, str)
            or not resolved.startswith("https://registry.npmjs.org/")
            or re.fullmatch(r"sha512-[A-Za-z0-9+/=]+", str(metadata.get("integrity", ""))) is None
        ):
            fail("bootstrap package source rejected")
    shutil.copytree(source, destination)
finally:
    shutil.rmtree(extract, ignore_errors=True)
