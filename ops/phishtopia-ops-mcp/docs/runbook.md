# Operations runbook

## Recovered-baseline sidecar activation

When the recovered read-only tunnel is already healthy, install the worker and
external controller beside it from a merged immutable commit:

```sh
./scripts/activate-worker-controller-sidecar-cloud-shell.sh MERGED_COMMIT
```

Run this command directly in Google Cloud Shell. Do not wrap it in the Codex CLI
or an automatic retry loop. The installer is a single transaction with rollback
and already contains the required tests and readiness checks.

Worker readiness is checked once per second for up to 15 seconds. It fails
immediately if systemd reports a stopped, failed, restarting, or restarted
service. Success requires the correctly owned Unix socket and an exact worker
contract response. Controller readiness is checked once per second for up to 30
seconds. The relay must obtain its VM metadata token and verify its exact
subscription-consume and response-topic-publish permissions without consuming a
queued request. Runtime pulls are bounded non-waiting requests on a five-second
idle cadence, so a healthy empty queue cannot be misclassified as a transport
failure. A service failure, restart, or `controller_error` is terminal.

Failure output is deliberately bounded. It reports the install stage, a fixed
worker startup stage or controller error code when available, and only these
systemd fields: active state, substate, result, exit code, exit status, and
restart count. Raw journals and exception text are not returned. Let rollback
finish, preserve that diagnostic block, and diagnose it before making one new
attempt.

## Worker-sidecar updates

The recovered nine-tool tunnel remains at `/opt/phishtopia-ops-mcp`.
`upgrade_ops_release` stages a verified release under
`/opt/phishtopia-ops-worker-controller-releases`, atomically advances
`/opt/phishtopia-ops-worker-code`, and reexecs the root worker from that
persistent path. The tunnel pointer, unit, and launcher are not replaced.

The candidate standalone worker unit must exactly match the installed unit.
This is intentionally self-locking: an ordinary worker release cannot grant
itself a broader systemd sandbox. A reviewed unit-contract correction therefore
requires one controlled bridge installation with an exact backup, rollback,
unit verification, and health check before normal job-based upgrades resume.

## Before bootstrap

1. Record source hashes, unit/launcher/tunnel/credential fingerprints, service properties, IAM bindings, Cloud Run traffic, app commit/PM2 state, Nginx hashes, PostgreSQL schema/data hashes, DNS answers, TLS certificate, health results, and memory/disk headroom.
2. Confirm the imported Git source contains no dependencies, build output, `.tools`, env files, keys, credentials, logs, databases, or runtime state.
3. Require all PR checks and independent security review to pass.
4. Verify the merged commit and release archive digest outside the VM before extraction.
5. Confirm `/opt/phishtopia-ops-mcp/.tools/node` is present and the existing read-only tunnel is healthy.
6. Confirm at least 640 MB `MemAvailable`, 2 GB free disk, and an enabled version of the fixed zone-scoped `phishtopia-cloudflare-dns-token`. If any is absent, do not bootstrap.

## Staged bootstrap

Use a private mode-0700 staging directory. Verify the archive digest before extraction. Run the bundled installer from the independently verified archive source as root with only the immutable merged commit and expected digest; do not assume the legacy installed observer already contains bootstrap scripts:

```sh
sudo ./scripts/install-bootstrap.sh COMMIT_SHA ARTIFACT_SHA256
```

The installer tests the candidate before switching, copies a real non-symlink Node runtime into a root-owned stable path, retains the exact old source/worker state/units, starts the root service from the versioned ops release, preserves tunnel YAML/credential hashes, and has non-returning EXIT/HUP/INT/TERM recovery handlers. Every candidate child has a hard runtime bound. Only the post-installer verification watchdog remains, and install/recovery/finalization/manual rollback serialize on one root-only lock. The staged worker independently proves the fixed VM identity and read-only access to the exact Cloudflare zone and both fixed records before finalization.

## Verification

- `systemctl is-enabled/is-active` for both ops units.
- Exact 13-tool list and annotations; call only the ten read-only tools.
- `get_cloudflare_dns_status` reports an active token, visible `phishtopia.com` zone, readable root A and `www` CNAME, root target `34.73.92.179`, current production `www` target `phishtopia.com`, and DNS-only proxy state. The separately allowlisted Cloud Run CNAME remains a possible typed DNS-job target and is not the current production baseline.
- Restart worker, then tunnel; repeat protocol/read-only smoke.
- Tunnel private listener remains `127.0.0.1:18081`; no new public listener.
- Worker socket is `root:phishtopia-mcp` `0660`; database/audit are root-only.
- Combined runtime RSS and host `MemAvailable` remain safe.
- Public health/root/login, TLS certificate, Nginx syntax/hashes, PostgreSQL schema/data hashes, PM2 status/restart count, app Git commit, Cloud Run traffic/revisions, DNS answers, and IAM hashes match the baseline.
- Tunnel YAML and credential fingerprints match byte-for-byte.

After every check above passes, commit the staged transaction:

```sh
sudo ./scripts/finalize-bootstrap.sh
```

The finalizer disables automatic recovery and atomically retains `/var/lib/phishtopia-ops-bootstrap-last-good` plus its fixed manual rollback helper.

Do not start a mutating job merely to test it. DNS, migration, secret, traffic, deployment, and rollback paths are tested with fakes/disposable resources in CI.

## Emergency rollback

If staged verification fails, allow the installer trap or verification watchdog to finish. After finalization, the only supported exact baseline rollback is:

```sh
sudo /usr/local/sbin/phishtopia-ops-rollback-last-good
```

This helper is safe only in the narrow window after finalization and before the first job is submitted or any application release is installed. It gates new jobs, quiesces the worker, and refuses to proceed if _any_ durable job history exists, the application current path has become a release symlink, or the post-bootstrap application release directory is nonempty. It then archives the post-bootstrap worker state and invokes fixed exact recovery. Once that safe-use window closes, use a typed `rollback_release` job or the action-specific rollback path; never invoke the retained bootstrap helper. Recheck the ten observer tools and public production invariants before any other change.

Never delete rollback source, Secret Manager versions, database backups, or traffic/DNS snapshots until the corresponding job is terminal and verified.
