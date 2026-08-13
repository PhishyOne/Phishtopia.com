# Threat model

## Assets

- Public website availability and TLS.
- Existing sessions and database contents.
- Tunnel credential and tunnel configuration.
- App environment and Secret Manager payloads.
- DNS record state and Cloud Run traffic.
- Verified release provenance and rollback targets.
- Audit integrity and job durability.

## Adversaries and failures

- Prompt injection attempting to smuggle shell, paths, URLs, SQL, headers, or executable text.
- A compromised or buggy unprivileged MCP process.
- Command argument injection through release/revision/migration/DNS identifiers.
- Malicious archive entries or dependency lifecycle behavior.
- Worker crash, VM restart, timeout, or cancellation mid-action.
- Secret/log leakage through exceptions, subprocess output, audit, or MCP observations.
- Concurrent actions racing on one protected resource.
- Failed health gates or partial external convergence.
- Overcommit on the e2-micro VM.

## Controls

- Exact schemas in both trust domains; non-shell subprocess execution.
- Fixed executables, commands, repository, project, region, VM, service, bucket, database, secrets, service names, and DNS hosts.
- Immutable commit/check/archive verification and safe extraction.
- No credential-bearing environment inherited by child commands except data passed privately to one fixed Secret Manager operation.
- Root-only durable baselines and stable sanitized result codes.
- Resource uniqueness in SQLite, fixed deadlines, a durable pre-mutation checkpoint, and verified rollback only after mutation may have started.
- No public worker listener; local peer credential check.
- Systemd sandboxing, exact transient-unit cancellation, task/fd/memory/output limits, and action-specific memory/disk gates.
- The worker filesystem remains read-only except for fixed state/release paths,
  the application error-log directory, and `/var/log/nginx`. The last
  exception is directory-scoped because `nginx -t` opens configured log files
  while validating; the `/var/log` parent remains read-only.
- Count-only post-change error gates; immutable app releases use the fixed external `/var/log/phishtopia` directory and no raw log content enters a job or audit event.
- The release observer accepts no arguments and resolves only the fixed app and deployment-log paths. It validates the active release or exact Git `HEAD`, opens the log with `O_NOFOLLOW`, requires a regular file with the expected owner and no group/world write bit, verifies the opened inode, reads only the final 65,536 bytes, and fails closed on a concurrent change. Only exact lowercase commit identifiers and sanitized metadata leave the worker; raw bytes never do.
- General rollback invariants use stable PostgreSQL schema/configuration hashes and exclude mutable database rows and counts; exact data fingerprints remain confined to the tested migration workflow.
- Ops upgrades disable Python bytecode writes and use a durable reexec checkpoint from the selected release directory so the newly loaded root worker, not the old process, must verify the release before terminal success.
- Ops upgrades move the persistent worker-sidecar symlink used by systemd and
  do not repoint the recovered ten-tool MCP tunnel. Activating a newly defined
  observer requires an independent verified tunnel release and rollback plan.
- Audit selection, append, fsync, and database acknowledgement share one lock so concurrent admission and worker transitions cannot duplicate or reorder a flush batch.
- Production mutations are excluded from tests; fakes and disposable local resources cover the high-impact paths.

## Residual risks

- The VM service account baseline predates this change and currently includes project-wide roles broader than the issue's stated viewer-only foundation. This change adds no IAM role. A separate least-privilege IAM remediation must be verified against the existing Cloud Build/Cloud Run pipeline before removal; silently removing those roles during this bootstrap could break production deployment.
- DNS cannot be operational until a zone-scoped edit token exists in the fixed secret. The worker intentionally fails closed if it is absent.
- GitHub archive verification depends on GitHub TLS/API availability and the configured check names.
- A root compromise is outside the worker boundary; the worker reduces exposed root verbs but cannot defend the host from an already-root attacker.
