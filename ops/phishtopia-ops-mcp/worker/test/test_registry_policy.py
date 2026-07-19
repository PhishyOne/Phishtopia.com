from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


PACKAGE_ROOT = Path(__file__).resolve().parents[2]
POLICY = PACKAGE_ROOT / "scripts" / "registry-policy.py"
SPEC = importlib.util.spec_from_file_location("registry_policy", POLICY)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("registry policy could not be loaded")
REGISTRY_POLICY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(REGISTRY_POLICY)


class RegistryPolicyTests(unittest.TestCase):
    def test_current_twelve_ipv4_and_twelve_ipv6_shape_is_accepted(self) -> None:
        values = [f"8.8.8.{index}" for index in range(1, 13)] + [
            f"2001:4860:4860::{index:x}" for index in range(1, 13)
        ]

        addresses = REGISTRY_POLICY.normalize_registry_addresses(values)

        self.assertEqual(len(addresses), 24)
        self.assertEqual(addresses[:2], ("8.8.8.1", "8.8.8.2"))
        self.assertEqual(addresses[-1], "2001:4860:4860::c")

    def test_sixteen_addresses_per_family_is_the_hard_boundary(self) -> None:
        values = [f"8.8.8.{index}" for index in range(1, 17)] + [
            f"2001:4860:4860::{index:x}" for index in range(1, 17)
        ]
        self.assertEqual(
            len(REGISTRY_POLICY.normalize_registry_addresses(values)),
            32,
        )

        with self.assertRaises(SystemExit):
            REGISTRY_POLICY.normalize_registry_addresses(
                [f"8.8.8.{index}" for index in range(1, 18)]
            )
        with self.assertRaises(SystemExit):
            REGISTRY_POLICY.normalize_registry_addresses(
                [f"2001:4860:4860::{index:x}" for index in range(1, 18)]
            )

    def test_only_global_literal_addresses_are_accepted(self) -> None:
        for value in ("", "not-an-address", "127.0.0.1", "10.0.0.1", "::1", "fe80::1"):
            with self.subTest(value=value), self.assertRaises(SystemExit):
                REGISTRY_POLICY.normalize_registry_addresses([value])

    def test_duplicates_are_deduplicated_and_output_is_deterministic(self) -> None:
        addresses = REGISTRY_POLICY.normalize_registry_addresses(
            ["2001:4860:4860::2", "8.8.8.2", "8.8.8.1", "8.8.8.2"]
        )
        self.assertEqual(
            addresses,
            ("8.8.8.1", "8.8.8.2", "2001:4860:4860::2"),
        )
        self.assertEqual(
            REGISTRY_POLICY.render_hosts(addresses),
            b"127.0.0.1 localhost\n"
            b"::1 localhost\n"
            b"8.8.8.1 registry.npmjs.org\n"
            b"8.8.8.2 registry.npmjs.org\n"
            b"2001:4860:4860::2 registry.npmjs.org\n",
        )


if __name__ == "__main__":
    unittest.main()
