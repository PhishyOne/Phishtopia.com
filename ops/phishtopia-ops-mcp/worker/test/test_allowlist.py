from __future__ import annotations

import unittest

from worker.allowlist import (
    ACTION_NAMES,
    DNS_CNAME_TARGETS,
    ValidationError,
    resource_for,
    validate_action,
)


COMMIT = "a" * 40
DIGEST = "b" * 64


def actions() -> list[dict[str, object]]:
    return [
        {"type": "upgrade_ops_release", "commit": COMMIT, "artifactSha256": DIGEST},
        {"type": "deploy_verified_release", "commit": COMMIT, "artifactSha256": DIGEST},
        {"type": "restart_phishtopia_service", "service": "phishtopia_app"},
        {"type": "rollback_release", "target": "phishtopia_ops", "release": COMMIT},
        {"type": "canary_and_promote", "revision": "phishtopia-00041-pqc", "percentages": [5, 25, 100]},
        {"type": "run_tested_migration", "commit": COMMIT, "artifactSha256": DIGEST, "migrationId": "20260718000000_bootstrap"},
        {"type": "rotate_session_secret", "secret": "phishtopia-session-secret"},
        {"type": "update_dns_with_rollback", "hostname": "phishtopia.com", "recordType": "A", "value": "34.73.92.179", "ttl": 300},
    ]


class AllowlistTests(unittest.TestCase):
    def test_every_action_has_an_exact_independent_schema(self) -> None:
        validated = [validate_action(action) for action in actions()]
        self.assertEqual({action["type"] for action in validated}, ACTION_NAMES)
        self.assertEqual(
            {resource_for(action) for action in validated}, {"production_mutation"}
        )

    def test_unknown_fields_and_model_controlled_capabilities_are_rejected(self) -> None:
        forbidden_fields = {
            "command": "systemctl restart ssh",
            "path": "/etc/shadow",
            "url": "https://attacker.example",
            "sql": "DROP DATABASE phishtopia",
            "headers": {"Authorization": "secret"},
        }
        for field, value in forbidden_fields.items():
            candidate = dict(actions()[0])
            candidate[field] = value
            with self.subTest(field=field), self.assertRaises(ValidationError):
                validate_action(candidate)

    def test_injection_strings_cannot_enter_fixed_identifiers(self) -> None:
        mutations = [
            {"type": "upgrade_ops_release", "commit": "a" * 39 + ";", "artifactSha256": DIGEST},
            {"type": "restart_phishtopia_service", "service": "phishtopia_app; reboot"},
            {"type": "canary_and_promote", "revision": "latest", "percentages": [100]},
            {"type": "run_tested_migration", "commit": COMMIT, "artifactSha256": DIGEST, "migrationId": "20260718000000_x;DROP"},
            {"type": "update_dns_with_rollback", "hostname": "evil.example", "recordType": "CNAME", "value": "https://attacker.example", "ttl": 300},
        ]
        for candidate in mutations:
            with self.subTest(candidate=candidate["type"]), self.assertRaises(ValidationError):
                validate_action(candidate)

    def test_dns_type_and_value_must_match(self) -> None:
        with self.assertRaises(ValidationError):
            validate_action({"type": "update_dns_with_rollback", "hostname": "phishtopia.com", "recordType": "A", "value": "www.phishtopia.com", "ttl": 300})
        cname = validate_action({"type": "update_dns_with_rollback", "hostname": "www.phishtopia.com", "recordType": "CNAME", "value": "phishtopia-ht3gdpkzmq-ue.a.run.app.", "ttl": 60})
        self.assertEqual(cname["value"], "phishtopia-ht3gdpkzmq-ue.a.run.app")
        for hostname, record_type, value in (
            ("www.phishtopia.com", "A", "34.73.92.179"),
            (
                "phishtopia.com",
                "CNAME",
                "phishtopia-ht3gdpkzmq-ue.a.run.app",
            ),
        ):
            with self.subTest(hostname=hostname), self.assertRaises(ValidationError):
                validate_action(
                    {
                        "type": "update_dns_with_rollback",
                        "hostname": hostname,
                        "recordType": record_type,
                        "value": value,
                        "ttl": 300,
                    }
                )

    def test_www_cname_accepts_exact_current_and_future_targets(self) -> None:
        expected = frozenset(
            ("phishtopia.com", "phishtopia-ht3gdpkzmq-ue.a.run.app")
        )
        self.assertEqual(DNS_CNAME_TARGETS, expected)
        for value in expected:
            with self.subTest(value=value):
                action = validate_action(
                    {
                        "type": "update_dns_with_rollback",
                        "hostname": "www.phishtopia.com",
                        "recordType": "CNAME",
                        "value": value,
                        "ttl": 300,
                    }
                )
                self.assertEqual(action["value"], value)

    def test_www_cname_rejects_every_other_target_with_specific_code(self) -> None:
        for value in (
            "attacker.example",
            "www.phishtopia.com",
            "phishtopia.run.app",
        ):
            with self.subTest(value=value), self.assertRaisesRegex(
                ValidationError, "^dns_target_not_allowlisted$"
            ):
                validate_action(
                    {
                        "type": "update_dns_with_rollback",
                        "hostname": "www.phishtopia.com",
                        "recordType": "CNAME",
                        "value": value,
                        "ttl": 300,
                    }
                )

    def test_canary_requires_a_real_gradual_stage(self) -> None:
        for percentages in ([100], [25, 100]):
            with self.subTest(percentages=percentages), self.assertRaises(ValidationError):
                validate_action(
                    {
                        "type": "canary_and_promote",
                        "revision": "phishtopia-00041-pqc",
                        "percentages": percentages,
                    }
                )

    def test_dns_rejects_every_target_not_owned_by_this_project(self) -> None:
        for record_type, value in (
            ("A", "34.73.92.180"),
            ("A", "127.0.0.1"),
            ("A", "10.0.0.1"),
            ("A", "169.254.169.254"),
            ("A", "0.0.0.0"),
            ("AAAA", "::1"),
            ("AAAA", "fe80::1"),
            ("AAAA", "fc00::1"),
            ("CNAME", "attacker.example"),
        ):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                validate_action(
                    {
                        "type": "update_dns_with_rollback",
                        "hostname": "www.phishtopia.com",
                        "recordType": record_type,
                        "value": value,
                        "ttl": 300,
                    }
                )


if __name__ == "__main__":
    unittest.main()
