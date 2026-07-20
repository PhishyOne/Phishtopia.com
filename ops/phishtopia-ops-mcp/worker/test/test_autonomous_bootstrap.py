from __future__ import annotations

import hashlib
import importlib.util
import unittest
from pathlib import Path
from types import ModuleType

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = PACKAGE_ROOT / "scripts"
AUTONOMOUS = SCRIPTS / "autonomous-bootstrap.sh"
TUNNEL_PREFLIGHT = SCRIPTS / "tunnel-preflight.sh"
POSTGRES_FINGERPRINT = SCRIPTS / "postgres-fingerprint.py"
SANITIZER = SCRIPTS / "sanitize-bootstrap-diagnostics.py"


def load_module(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError("test module could not be loaded")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AutonomousBootstrapTests(unittest.TestCase):
    def test_schema_normalization_ignores_only_transport_metadata(self) -> None:
        module = load_module(POSTGRES_FINGERPRINT, "postgres_fingerprint_test")
        first = b"""-- PostgreSQL database dump
-- Dumped by pg_dump version 17
\restrict abc

CREATE TABLE public.users (id integer);
\unrestrict abc
"""
        second = b"""-- PostgreSQL database dump
-- Dumped by pg_dump version 18
\restrict different
CREATE TABLE public.users (id integer);
\unrestrict different
-- Completed on tomorrow
"""
        changed = second.replace(b"id integer", b"id bigint")

        def digest(value: bytes) -> str:
            result = hashlib.sha256()
            for line in module.normalize_schema_lines(value.splitlines(keepends=True)):
                result.update(line)
            return result.hexdigest()

        self.assertEqual(digest(first), digest(second))
        self.assertNotEqual(digest(first), digest(changed))

    def test_identifier_quoting_is_exact_and_rejects_nul(self) -> None:
        module = load_module(POSTGRES_FINGERPRINT, "postgres_identifier_test")
        self.assertEqual(module.quote_identifier('odd"name'), '"odd""name"')
        with self.assertRaisesRegex(ValueError, "invalid_postgres_identifier"):
            module.quote_identifier("bad\x00name")

    def test_sanitizer_preserves_errors_and_digests_but_redacts_credentials(self) -> None:
        module = load_module(SANITIZER, "bootstrap_sanitizer_test")
        digest = "a" * 40
        bearer = "super-" + "secret-" + "control-plane-" + "value-123456"
        credential_value = "abcdefghijklm" + "nopqrstuvwxyz" + "0123456789ABCD"
        source = (
            "status=1/FAILURE\n"
            f"Authorization: Bearer {bearer}\n"
            f"credential={credential_value}\n"
            f"release={digest}\n"
            "tunnel client: permission denied\n"
        )
        result = module.sanitize(source)
        self.assertIn("status=1/FAILURE", result)
        self.assertIn("permission denied", result)
        self.assertIn(f"release={digest}", result)
        self.assertNotIn(bearer, result)
        self.assertNotIn(credential_value, result)
        self.assertGreaterEqual(result.count("[REDACTED]"), 2)

    def test_tunnel_preflight_matches_hardened_service_boundary(self) -> None:
        value = TUNNEL_PREFLIGHT.read_text(encoding="utf8")
        required = (
            "--uid=phishtopia-mcp --gid=phishtopia-mcp",
            "credential_name='control-plane-api''-key'",
            'credential_path="/etc/credstore/phishtopia-ops-mcp/$credential_name"',
            "LoadCredential=$credential_name:$credential_path",
            "ProtectSystem=strict",
            "ProtectHome=yes",
            "ProtectProc=invisible",
            "RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
            "CapabilityBoundingSet=",
            "RuntimeMaxSec=90",
            '"$copy" doctor',
        )
        for item in required:
            self.assertIn(item, value)
        self.assertNotIn("PrivateNetwork=yes", value)
        self.assertNotIn("CONTROL_PLANE_API_KEY=", value)

    def test_autonomous_wrapper_is_single_attempt_and_fail_closed(self) -> None:
        value = AUTONOMOUS.read_text(encoding="utf8")
        preflight = value.index("stage=tunnel_preflight")
        installer = value.index("stage=installer")
        restart = value.index("stage=restart_verification")
        finalization = value.index("stage=finalization")
        self.assertLess(preflight, installer)
        self.assertLess(installer, restart)
        self.assertLess(restart, finalization)
        self.assertEqual(
            value.count('install-bootstrap.sh" "$release" "$artifact_digest"'), 1
        )
        self.assertIn("capture_failure", value)
        self.assertIn("sanitize-bootstrap-diagnostics.py", value)
        self.assertIn("PHISHTOPIA_BOOTSTRAP_SELF_RECOVERY=1", value)
        self.assertIn("postgres-fingerprint.py", value)
        self.assertIn("cmp -s", value)
        self.assertIn("live-smoke.js", value)
        self.assertIn("retained_last_known_good", value)
        self.assertNotIn("while true", value)
        self.assertNotIn("until ", value)

    def test_fingerprint_is_fixed_scope_and_excludes_runtime_session_churn(self) -> None:
        value = POSTGRES_FINGERPRINT.read_text(encoding="utf8")
        self.assertIn('DATABASE = "phishtopia"', value)
        self.assertIn(
            'EXCLUDED_RUNTIME_TABLES = frozenset({("public", "session")})', value
        )
        self.assertIn("FROM ONLY", value)
        self.assertIn('COLLATE "C"', value)
        self.assertIn("protected_data_sha256", value)
        self.assertNotIn("print(row", value)
        self.assertNotIn("stdout.write", value)


if __name__ == "__main__":
    unittest.main()
