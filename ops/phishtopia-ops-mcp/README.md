# Phishtopia Ops MCP

Private Phishtopia operations control plane for Issue #15. The MCP server remains an unprivileged stdio process behind the existing Secure MCP Tunnel. It exposes nine compatible read-only observers and three job tools. A separate root service accepts only a small local JSON protocol, validates every action again, persists jobs, and executes fixed operations.

## Tool contract

The final MCP contract contains 12 tools:

- `get_production_summary`
- `get_public_health`
- `get_vm_status`
- `get_backup_status`
- `get_monitoring_status`
- `get_cloud_run_status`
- `get_recent_sanitized_errors`
- `get_build_status`
- `get_secret_metadata`
- `start_job`
- `get_job_status`
- `cancel_job`

The first nine retain their installed schemas and read-only annotations. `start_job` accepts exactly one of eight discriminated action schemas and an idempotency key. `get_job_status` and `cancel_job` accept only a UUID. Mutating job tools are annotated `readOnlyHint: false`, `destructiveHint: true`, `idempotentHint: true`, and `openWorldHint: false`.

## Action allowlist

- `upgrade_ops_release`: exact lowercase 40-character commit and 64-character archive digest.
- `deploy_verified_release`: exact lowercase 40-character commit and 64-character archive digest.
- `restart_phishtopia_service`: `phishtopia_app` or `phishtopia_ops_tunnel` only.
- `rollback_release`: recorded app or ops release only.
- `canary_and_promote`: an explicit `phishtopia-NNNNN-xxx` revision and two or more increasing fixed percentages, beginning no higher than 10 and ending at 100.
- `run_tested_migration`: exact commit/digest and a repository manifest ID only.
- `rotate_session_secret`: `phishtopia-session-secret` only; no payload accepted or returned.
- `update_dns_with_rollback`: `phishtopia.com` or `www.phishtopia.com`, targeting only the fixed VM A address or fixed Cloud Run CNAME, and one of three TTLs. Records must remain DNS-only.

No schema includes a shell command, file path, URL, HTTP headers, SQL text, log query, credential, cookie, secret value, database row selector, project, service account, repository, bucket, database, zone, or arbitrary resource name.

## Boundary

```text
private tunnel -> unprivileged MCP -> root-owned Unix socket -> root worker
                                             |              |
                                             |              +-- fixed action builders
                                             +-- strict      +-- rollback baselines
                                                 JSON        +-- SQLite WAL jobs
                                                              +-- append-only audit
```

The Unix socket is `root:phishtopia-mcp` mode `0660`. The worker checks Linux peer credentials in addition to filesystem permissions. The MCP service has no capabilities and no write access to worker state. The worker database and audit log are root-only mode `0600`.

See [architecture.md](docs/architecture.md), [threat-model.md](docs/threat-model.md), and [runbook.md](docs/runbook.md).

## Safety and durability

- SQLite uses WAL and `synchronous=FULL`.
- An indexed partial uniqueness constraint permits only one queued/running/cancelling job per protected resource.
- Idempotency keys are unique and are bound to a canonical action hash.
- Deadlines are fixed by action; the model cannot extend them.
- Every long action checks cancellation/deadline boundaries.
- A worker restart converts interrupted work into a queued recovery job that restores the persisted baseline instead of blindly resuming a mutation.
- Audit records contain only job ID, action, fixed resource, state, event, result code, and time. Accepted jobs expose a bounded sanitized preview that never echoes a DNS target or secret.
- Errors are stable codes; subprocess output and exception messages are never returned.
- DNS snapshots, env backups, and other rollback material remain root-only and never enter audit/MCP output.

## Tests

All high-impact behavior is exercised through fakes or temporary local files/databases. The test suite does not call production DNS, Cloudflare, Secret Manager mutations, Cloud Run traffic updates, PostgreSQL mutations, PM2, systemd, or deployments.

```sh
npm ci
npm run typecheck
npm test
npm run smoke
python3 -m unittest discover -s worker/test -p 'test_*.py' -v
./scripts/secret-scan.sh
```

`npm run smoke` uses an in-memory MCP transport and checks the exact names/annotations without starting a job. `smoke:live` invokes only the nine read-only observers.

## Bootstrap prerequisite

The staged installer requires an already verified release archive, its SHA-256 digest, the merged immutable commit, at least 640 MB `MemAvailable`, and at least 2 GB free disk. It preserves the existing tunnel YAML and loaded credential byte-for-byte, retains the old source/state/units as an exact rollback target, runs the separate root service from the versioned ops source, and restarts only the worker and `phishtopia-ops-mcp-tunnel.service`. A single post-installer verification timer rolls back the staged transaction unless external verification calls the fixed finalizer. Finalization atomically retains the pre-bootstrap state as a root-only last-known-good snapshot; that snapshot may be used only before any job history or application release exists.

DNS mutation additionally requires a Cloudflare API token scoped only to DNS edit for the `phishtopia.com` zone, stored as the fixed Secret Manager secret `phishtopia-cloudflare-dns-token` with accessor permission granted only on that secret. The installer checks for an enabled version and fails before journal/source copying if it is absent; an analytics/read-only token is not accepted as a substitute. The action schema permits only the fixed VM A address or fixed Cloud Run CNAME.
