# Architecture

## Processes and authority

`phishtopia-ops-mcp-tunnel.service` runs as `phishtopia-mcp`. It retains the existing private tunnel profile and systemd credential. Its only new authority is connecting to the local worker socket. It cannot read worker state, app env files, rollback snapshots, or audit history.

`phishtopia-ops-worker.service` runs as root because the allowlisted actions must control one systemd unit, one PM2 app, local PostgreSQL, fixed release directories, and narrowly scoped cloud resources. The service is filesystem-sandboxed, capacity-limited, has a small capability bounding set, and never listens on TCP.

The Node and Python validators are deliberately independent implementations. A compromised MCP process cannot introduce new JSON keys or rely on a Node-side validation bug: the root worker requires exact key sets, formats, enum values, hostnames, release identifiers, and action/resource mappings.

## State machine

```text
queued -> running -> succeeded
   |         |  \
   |         |   +-> failed (verified rollback)
   |         +-----> cancelling -> cancelled (verified rollback)
   +---------------> cancelled (no mutation occurred)
```

`rollback_failed` is reported distinctly and leaves an audit event requiring operator attention. It is never mislabeled as a successful rollback.

At startup, an interrupted `running` or `cancelling` job is moved to `queued`; when selected, the executor sees its persisted baseline and performs recovery rollback before setting a terminal state. The sole exception is the explicit `worker_handoff_pending` checkpoint: the new root worker must prove its own contract, tunnel readiness, unit contract, and production invariants before success is committed; failure restores the old ops symlink and reexecs the old worker. This chooses safety over repeating a partially completed mutation.

## Release verification

Deploy and self-upgrade actions construct GitHub API URLs internally for `PhishyOne/Phishtopia.com`. They require:

1. An exact 40-character commit.
2. Completed successful GitHub checks, including both a test check and an ops security check.
3. Proof that the commit is on fixed `main` through GitHub's compare API.
4. A streamed archive no larger than 600 MB whose SHA-256 equals the supplied digest.
5. Safe tar entries: no links, devices, traversal, excessive count, or oversized file.
6. Locked dependency install, typecheck, tests, and protocol smoke before switching.

The model cannot supply a URL, branch, repository, directory, npm command, or test command.

## Action rollback summaries

- Ops/app release: capture the exact current target, atomically switch a fixed symlink, health gate, then restore the original target on any failure. Ops changes also perform a durable reexec handoff; the systemd sandbox contract is immutable within the v1 action schema and differing candidate units are rejected.
- Restart: configuration is unchanged; a failed restart is retried from the captured service baseline and gated on health.
- Canary: capture the exact Cloud Run traffic array and reconstruct it exactly on failure/cancellation.
- Migration: require a fresh off-VM verified dump and disposable local restore rehearsal; accept only non-destructive transactional manifest SQL. Production execution is one transaction.
- Secret: retain the prior Secret Manager versions, use a root-only exact env backup, fail closed if Cloud Run declares `SESSION_SECRET` as a consumer, validate the PM2 consumer, and disable newly introduced versions during rollback. Payloads are never logged or returned.
- DNS: retain exact record fields in root-only state, force `proxied=false`, require recursive convergence plus TLS/app health on the hostname actually changed (with only the fixed `www` to apex redirect), and PUT the exact snapshot back on failure.

Every action captures a count-only fixed application error signal and rejects any new error marker after mutation. No raw log bytes or messages cross the worker boundary.

## Output boundary

Job output contains a UUID, action enum, state, progress, timestamps, stable result code, and at most 12 short observations. It excludes command output, logs, URLs, IPs except an explicitly requested DNS value (which is not echoed), release archive content, SQL, database rows, principals, environment values, secrets, Cloudflare responses, and rollback snapshots.
