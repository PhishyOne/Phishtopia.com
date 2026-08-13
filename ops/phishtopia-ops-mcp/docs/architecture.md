# Architecture

## Processes and authority

`phishtopia-ops-mcp-tunnel.service` runs as `phishtopia-mcp`. It retains the existing private tunnel profile and systemd credential. Its only new authority is connecting to the local worker socket. It cannot read worker state, app env files, rollback snapshots, or audit history.

`phishtopia-ops-worker.service` runs as root because the allowlisted actions must control one systemd unit, one PM2 app, local PostgreSQL, fixed release directories, and narrowly scoped cloud resources. The service is filesystem-sandboxed, capacity-limited, has a small capability bounding set, and never listens on TCP.

The recovered ten-tool MCP tunnel remains rooted at
`/opt/phishtopia-ops-mcp`. The independently installed root worker starts
through `/opt/phishtopia-ops-worker-code`, whose releases are stored under
`/opt/phishtopia-ops-worker-controller-releases`. An
`upgrade_ops_release` job advances that persistent worker pointer and reexecs
the worker from it. It does not repoint the recovered MCP tunnel. This keeps a
later systemd restart on the same verified worker release instead of silently
falling back to the activation-time sidecar.

The source contract also defines `get_release_status`, an eleventh read-only
observer. The unprivileged Node process sends one fixed, argument-free request
over the existing worker socket. The worker resolves only the fixed application
checkout and fixed deployment-log path, then returns the exact active commit and
a sanitized correlation summary. No caller-controlled path or raw log content
crosses either boundary. The tool becomes available only after both the worker
and the recovered MCP tunnel are activated from a compatible verified release;
the worker-only `upgrade_ops_release` action intentionally does not accomplish
that tunnel activation.

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

At startup, an interrupted `running` or `cancelling` job is moved to `queued`; when selected, the executor sees its persisted baseline and performs recovery rollback before setting a terminal state. The sole exception is the explicit `worker_handoff_pending` checkpoint: the daemon changes into the selected release before reexec so the prior working directory cannot shadow it, and the newly loaded root worker must prove its own contract, tunnel readiness, unit contract, and production invariants before success is committed. Failure restores the old ops symlink and reexecs the old worker. This chooses safety over repeating a partially completed mutation.

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

- Ops/app release: capture the exact current target, atomically switch a fixed symlink, health gate, then restore the original target on any failure. Ops changes switch the persistent worker-sidecar pointer and perform a durable reexec handoff; the recovered read-only MCP pointer remains unchanged. Python bytecode writes are disabled during candidate tests and worker runtime so immutable tree digests remain stable. The installed standalone worker unit must match the candidate byte-for-byte, so a release cannot silently broaden its own systemd sandbox.
- Restart: configuration is unchanged; a failed restart is retried from the captured service baseline and gated on health.
- Canary: capture the exact Cloud Run traffic array and reconstruct it exactly on failure/cancellation.
- Migration: require a fresh off-VM verified dump and disposable local restore rehearsal; accept only non-destructive transactional manifest SQL. Production execution is one transaction.
- Secret: retain the prior Secret Manager versions, use a root-only exact env backup, fail closed if Cloud Run declares `SESSION_SECRET` as a consumer, verify the newly issued application session cookie against the rotated secret, and disable newly introduced versions during rollback. PM2 metadata is used only for process health, never as proof of the application-loaded value. Cookies and secret payloads are never logged or returned.

General production rollback invariants hash PostgreSQL schema only; mutable row data and counts are deliberately excluded so legitimate sessions, users, and comments cannot invalidate an unrelated operation. The tested migration workflow separately uses exact schema/data fingerprints on its disposable rehearsal and action-specific live checks.

- DNS: retain exact record fields in root-only state, force `proxied=false`, require recursive convergence plus TLS/app health on the hostname actually changed (with only the fixed `www` to apex redirect), and PUT the exact snapshot back on failure.

Every action captures a count-only fixed application error signal and rejects any new error marker after mutation. No raw log bytes or messages cross the worker boundary.

## Output boundary

Job output contains a UUID, action enum, state, progress, timestamps, stable result code, and at most 12 short observations. It excludes command output, logs, URLs, IPs except an explicitly requested DNS value (which is not echoed), release archive content, SQL, database rows, principals, environment values, secrets, Cloudflare responses, and rollback snapshots.

Release-observer output is not job output. It is limited to validated commit
identifiers, fixed status enums, a UTC log timestamp, a bounded-byte count, and
a commit-match boolean. The worker opens the deployment log without following
symlinks, accepts only its expected owner and non-writable permissions, reads at
most the final 65,536 bytes, and fails closed if the file changes during the
read. It never decodes or returns log lines.
