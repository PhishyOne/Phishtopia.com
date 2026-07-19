from __future__ import annotations

import re
from typing import Any

PROJECT_ID = "project-43a8be4b-69a7-4d52-805"
REGION = "us-east1"
ZONE = "us-east1-b"
VM_NAME = "phishtopia-vm"
CLOUD_RUN_SERVICE = "phishtopia"
REPOSITORY = "PhishyOne/Phishtopia.com"
BACKUP_BUCKET = "project-43a8be4b-69a7-4d52-805-phishtopia-backups"
DATABASE = "phishtopia"
SESSION_SECRET = "phishtopia-session-secret"
DNS_TOKEN_SECRET = "phishtopia-cloudflare-dns-token"
DNS_HOSTS = frozenset(("phishtopia.com", "www.phishtopia.com"))
DNS_A_TARGETS = frozenset(("34.73.92.179",))
DNS_CNAME_TARGETS = frozenset(("phishtopia-ht3gdpkzmq-ue.a.run.app",))
SERVICE_NAMES = frozenset(("phishtopia_app", "phishtopia_ops_tunnel"))
TARGET_NAMES = frozenset(("phishtopia_app", "phishtopia_ops"))

ACTION_NAMES = frozenset(
    (
        "upgrade_ops_release",
        "deploy_verified_release",
        "restart_phishtopia_service",
        "rollback_release",
        "canary_and_promote",
        "run_tested_migration",
        "rotate_session_secret",
        "update_dns_with_rollback",
    )
)

DEADLINES_SECONDS = {
    "upgrade_ops_release": 1_200,
    "deploy_verified_release": 1_200,
    "restart_phishtopia_service": 180,
    "rollback_release": 600,
    "canary_and_promote": 1_800,
    "run_tested_migration": 2_700,
    "rotate_session_secret": 600,
    "update_dns_with_rollback": 1_200,
}

_COMMIT = re.compile(r"^[0-9a-f]{40}$")
_DIGEST = re.compile(r"^[0-9a-f]{64}$")
_IDEMPOTENCY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{7,95}$")
_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.I,
)
_REVISION = re.compile(r"^phishtopia-[0-9]{5}-[a-z0-9]{3}$")
_MIGRATION = re.compile(r"^[0-9]{14}_[a-z][a-z0-9_]{0,47}$")
class ValidationError(ValueError):
    pass


def _exact(value: Any, keys: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != keys:
        raise ValidationError(f"invalid_{label}_fields")
    return value


def _text(value: Any, pattern: re.Pattern[str], label: str) -> str:
    if not isinstance(value, str) or not pattern.fullmatch(value):
        raise ValidationError(f"invalid_{label}")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise ValidationError(f"invalid_{label}")
    return value


def validate_idempotency_key(value: Any) -> str:
    return _text(value, _IDEMPOTENCY, "idempotency_key")


def validate_job_id(value: Any) -> str:
    return _text(value, _UUID, "job_id").lower()


def _dns_value(value: Any, record_type: str) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 253:
        raise ValidationError("invalid_dns_value")
    normalized = value.rstrip(".").lower()
    targets = DNS_A_TARGETS if record_type == "A" else DNS_CNAME_TARGETS
    if normalized not in targets:
        raise ValidationError("dns_target_not_allowlisted")
    return normalized


def validate_action(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or not isinstance(value.get("type"), str):
        raise ValidationError("invalid_action")
    action_type = value["type"]
    if action_type not in ACTION_NAMES:
        raise ValidationError("unknown_action")

    if action_type in ("upgrade_ops_release", "deploy_verified_release"):
        action = _exact(value, {"type", "commit", "artifactSha256"}, "action")
        return {
            "type": action_type,
            "commit": _text(action["commit"], _COMMIT, "commit"),
            "artifactSha256": _text(
                action["artifactSha256"], _DIGEST, "artifact_digest"
            ),
        }
    if action_type == "restart_phishtopia_service":
        action = _exact(value, {"type", "service"}, "action")
        if action["service"] not in SERVICE_NAMES:
            raise ValidationError("invalid_service")
        return dict(action)
    if action_type == "rollback_release":
        action = _exact(value, {"type", "target", "release"}, "action")
        if action["target"] not in TARGET_NAMES:
            raise ValidationError("invalid_target")
        _text(action["release"], _COMMIT, "release")
        return dict(action)
    if action_type == "canary_and_promote":
        action = _exact(value, {"type", "revision", "percentages"}, "action")
        _text(action["revision"], _REVISION, "revision")
        percentages = action["percentages"]
        allowed = {1, 5, 10, 25, 50, 100}
        if (
            not isinstance(percentages, list)
            or not 2 <= len(percentages) <= 6
            or any(type(item) is not int or item not in allowed for item in percentages)
            or percentages[0] > 10
            or percentages[-1] != 100
            or percentages != sorted(set(percentages))
        ):
            raise ValidationError("invalid_canary_percentages")
        return {"type": action_type, "revision": action["revision"], "percentages": percentages}
    if action_type == "run_tested_migration":
        action = _exact(
            value, {"type", "commit", "artifactSha256", "migrationId"}, "action"
        )
        _text(action["commit"], _COMMIT, "commit")
        _text(action["artifactSha256"], _DIGEST, "artifact_digest")
        _text(action["migrationId"], _MIGRATION, "migration_id")
        return dict(action)
    if action_type == "rotate_session_secret":
        action = _exact(value, {"type", "secret"}, "action")
        if action["secret"] != SESSION_SECRET:
            raise ValidationError("invalid_secret")
        return dict(action)
    action = _exact(
        value, {"type", "hostname", "recordType", "value", "ttl"}, "action"
    )
    if action["hostname"] not in DNS_HOSTS:
        raise ValidationError("invalid_dns_hostname")
    if action["recordType"] not in {"A", "CNAME"}:
        raise ValidationError("invalid_dns_type")
    if (action["hostname"], action["recordType"]) not in {
        ("phishtopia.com", "A"),
        ("www.phishtopia.com", "CNAME"),
    }:
        raise ValidationError("invalid_dns_record_shape")
    if action["ttl"] not in {60, 300, 3600} or type(action["ttl"]) is not int:
        raise ValidationError("invalid_dns_ttl")
    return {
        "type": action_type,
        "hostname": action["hostname"],
        "recordType": action["recordType"],
        "value": _dns_value(action["value"], action["recordType"]),
        "ttl": action["ttl"],
    }


def resource_for(action: dict[str, Any]) -> str:
    # Every action touches at least one shared production gate (health, app
    # session state, traffic, release manifest, or rollback baseline).  The
    # first release deliberately serializes all mutations so two independently
    # correct rollbacks can never overwrite each other.
    if action.get("type") not in ACTION_NAMES:
        raise ValidationError("invalid_action_type")
    return "production_mutation"
