# Phishtopia Ops MCP

Private Phishtopia operations control plane for Issue #15. The ChatGPT-facing MCP server remains an unprivileged stdio process behind the Secure MCP Tunnel and exposes ten read-only observers. A separate root worker persists durable jobs and executes only fixed, independently validated operations.

## ChatGPT tool contract

The MCP contract is deliberately read-only:

- `get_production_summary`
- `get_public_health`
- `get_vm_status`
- `get_backup_status`
- `get_monitoring_status`
- `get_cloud_run_status`
- `get_recent_sanitized_errors`
- `get_build_status`
- `get_secret_metadata`
- `get_cloudflare_dns_status`

All ten use read-only annotations. The Cloudflare observer may read only the fixed DNS token and returns only strictly validated zone and record status; it never returns the token. `start_job`, `get_job_status`, and `cancel_job` are intentionally absent from the ChatGPT tool list so the private app remains read-only.

## External controller

Durable job submission, status, and cancellation move to a separate controller:

```text
owner comment on one locked GitHub issue
  -> GitHub Actions with short-lived Google OIDC
  -> fixed Pub/Sub request topic
  -> unprivileged VM relay
  -> root-owned worker Unix socket
  -> fixed action implementation and rollback controls
  -> fixed Pub/Sub response topic
  -> sanitized issue comment
```

The workflow and relay validate every command independently, then the existing worker validates it again. The controller accepts no shell command, file path, URL, SQL text, secret value, arbitrary resource name, or user-supplied idempotency key.

This change is dormant until the queue issue, repository variables, Workload Identity Federation binding, Pub/Sub resources, IAM grants, and VM relay service are configured. Merging it alone does not deploy or mutate production.

See [external-controller.md](docs/external-controller.md), [architecture.md](docs/architecture.md), [threat-model.md](docs/threat-model.md), and [runbook.md](docs/runbook.md).

## Action allowlist

- `upgrade_ops_release`: exact 40-character commit and 64-character archive digest.
- `deploy_verified_release`: exact commit and digest.
- `restart_phishtopia_service`: fixed app or Ops tunnel service only.
- `rollback_release`: recorded app or Ops release only.
- `canary_and_promote`: fixed revision syntax and increasing percentages ending at 100.
- `run_tested_migration`: exact commit/digest and repository manifest ID.
- `rotate_session_secret`: the fixed session secret only; no payload accepted or returned.
- `update_dns_with_rollback`: fixed hostnames, targets, TTLs, and DNS-only mode.

## Safety and durability

- The worker socket is `root:phishtopia-mcp` mode `0660` and checks Linux peer credentials.
- SQLite uses WAL and `synchronous=FULL`.
- Idempotency keys bind to canonical action hashes.
- Only one production mutation can be queued or running.
- Deadlines and rollback behavior are fixed by action.
- Worker state, rollback material, environment backups, and audit files remain root-only.
- Errors and observations are bounded and sanitized; raw provider output is never returned.
- The external controller binds immutable repository ID `997939289` and owner ID `123998606`.

## Tests

```sh
npm ci
npm run format:check
npm run typecheck
npm test
npm run smoke
python3 -m unittest discover -s worker/test -p 'test_*.py' -v
python3 -m unittest discover -s controller/test -p 'test_*.py' -v
python3 -m compileall -q controller
./scripts/secret-scan.sh
npm audit --omit=dev --audit-level=moderate
```

Tests use fakes or temporary local state and do not call production DNS, Cloudflare, Secret Manager mutations, Cloud Run traffic updates, PostgreSQL mutations, Pub/Sub, Workload Identity Federation, systemd, PM2, or deployments.
