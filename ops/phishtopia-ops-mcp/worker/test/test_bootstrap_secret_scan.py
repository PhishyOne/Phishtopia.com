from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[2]
VERIFIER = PACKAGE_ROOT / "scripts" / "verify-bootstrap-archive.py"
TUNNEL_UNIT = PACKAGE_ROOT / "systemd" / "phishtopia-ops-mcp-tunnel.service"
SPEC = importlib.util.spec_from_file_location("bootstrap_archive_verifier", VERIFIER)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("bootstrap archive verifier could not be loaded")
VERIFIER_MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VERIFIER_MODULE)

TOKEN_LIKE_VALUE = b"abcdefghijklmnop" + b"qrstuvwxyz012345"


class BootstrapSecretScanTests(unittest.TestCase):
    def test_required_loadcredential_directive_is_not_treated_as_a_secret(self) -> None:
        data = TUNNEL_UNIT.read_bytes()
        self.assertIn(b"LoadCredential=control-plane-api-key:", data)
        self.assertFalse(VERIFIER_MODULE.contains_secret_like_value(data))

    def test_actual_secret_assignments_remain_rejected(self) -> None:
        samples = (
            b'PASSWORD="' + TOKEN_LIKE_VALUE + b'"\n',
            b'DB_PASSWORD="' + TOKEN_LIKE_VALUE + b'"\n',
            b'api_key: "' + TOKEN_LIKE_VALUE + b'"\n',
            b'const apiKey = "' + TOKEN_LIKE_VALUE + b'";\n',
            b'{"credential": "' + TOKEN_LIKE_VALUE + b'"}\n',
            b'secret-key=' + TOKEN_LIKE_VALUE + b'\n',
            b'-----BEGIN ' + b'PRIVATE KEY-----\n',
            b'{"type":"' + b'service_account' + b'"}\n',
            b'{"private_' + b'key":"not-returned"}\n',
        )
        for sample in samples:
            with self.subTest(sample=sample):
                self.assertTrue(VERIFIER_MODULE.contains_secret_like_value(sample))

    def test_secret_keyword_inside_a_directive_or_reference_does_not_match(self) -> None:
        samples = (
            b"LoadCredential=control-plane-api-key:/etc/credstore/phishtopia-ops-mcp/control-plane-api-key\n",
            b"SetCredentialEncrypted=control-plane-api-key:opaque-reference-that-is-not-a-secret\n",
            b"CredentialStore=encrypted\n",
        )
        for sample in samples:
            with self.subTest(sample=sample):
                self.assertFalse(VERIFIER_MODULE.contains_secret_like_value(sample))


if __name__ == "__main__":
    unittest.main()
