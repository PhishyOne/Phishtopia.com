# Autonomous staged bootstrap

`autonomous-bootstrap.sh` is the single-entry wrapper for the next Phishtopia Ops bootstrap. It does not download artifacts or calculate trust independently; the caller must still supply an immutable commit archive at the existing fixed input path and its independently calculated SHA-256 digest.

Run it from the freshly verified release source as root:

```sh
/bin/sh ./scripts/autonomous-bootstrap.sh COMMIT_SHA ARTIFACT_SHA256
```

The wrapper performs one bounded attempt:

1. Creates a canonical PostgreSQL schema and protected-data fingerprint. Volatile `pg_dump` headers are ignored, rows are ordered canonically, and the live `public.session` table is explicitly excluded from protected-data comparison.
2. Runs `tunnel-client doctor` through a transient service under the tunnel service's hardened identity, systemd credential loading, filesystem protections, address-family restrictions, capability boundary, and memory/runtime ceilings. It does not start a second tunnel listener.
3. Calls the existing staged installer once.
4. Verifies the worker and tunnel services, finalizer ownership/mode, protocol contract, runtime preflight, all ten read-only observers, worker socket/state permissions, and the canonical PostgreSQL fingerprint.
5. Restarts the worker and then the tunnel and repeats verification.
6. Runs the installed finalizer and verifies the committed runtime and retained last-known-good rollback baseline.

There is no retry loop. Any failure records a root-only sanitized report at:

```text
/var/lib/phishtopia-ops-bootstrap-diagnostics/latest.txt
```

The report contains the fixed stage name, exit status, selected systemd result properties, and bounded worker/tunnel/preflight journal excerpts. Credential-like values and opaque token-shaped strings are redacted. If a staged transaction exists, the wrapper invokes the existing exact recovery helper after capturing evidence.

The wrapper never prints PostgreSQL rows, tunnel credentials, Cloudflare tokens, or control-plane keys. It does not submit a mutating Ops job.
