# External GitHub Ops controller

## Status

The ChatGPT Secure MCP app stays read-only. The external controller uses locked issue #43, fixed Pub/Sub resources, short-lived GitHub Workload Identity Federation, and an unprivileged VM relay. Cloud transport resources and narrow IAM were bootstrapped and verified before merge; the relay remains inactive until the controller-aware Ops release is installed.

## Queue contract

Only a newly created owner comment on locked issue #43 in `PhishyOne/Phishtopia.com` is accepted. The controller verifies immutable repository ID `997939289`, owner ID `123998606`, `author_association=OWNER`, the exact issue number, and the issue lock state. Bot comments are ignored to prevent response recursion.

A command has exactly two parts:

```text
/phishtopia-ops
{"operation":"start_job","payload":{"action":{"type":"restart_phishtopia_service","service":"phishtopia_app"}}}
```

Status and cancellation use the same prefix with `get_job_status` or `cancel_job` and one UUID `jobId`. Markdown fences, extra fields, alternate prefixes, arbitrary commands, and user-supplied idempotency keys are rejected. The idempotency key is derived from the immutable issue comment ID, so redelivery resolves to the same durable job.

## Fixed transport

- Project: `project-43a8be4b-69a7-4d52-805`
- Request topic: `phishtopia-ops-requests`
- VM request subscription: `phishtopia-ops-vm-requests`
- Response topic: `phishtopia-ops-responses`
- GitHub response subscription: `phishtopia-ops-github-responses`
- Worker socket: `/run/phishtopia-ops-worker/worker.sock`

No caller can select a project, topic, subscription, endpoint, socket, repository, owner, or service account.

## Identity boundary

The GitHub controller service account has only:

- publish permission on the request topic;
- consume/acknowledge permission on the GitHub response subscription.

The VM service identity has only:

- consume/acknowledge permission on the VM request subscription;
- publish permission on the response topic.

Do not grant Pub/Sub Admin, Project Editor/Owner, Compute Admin, OS Login, service-account-key creation, Secret Accessor, or SSH permissions. Workload Identity Federation binds immutable repository ID, owner ID, exact workflow on `main`, owner actor ID, and the `issue_comment` event. No JSON service-account key is stored in GitHub.

The queue issue, WIF provider, and controller service-account identifiers are fixed directly in the workflow because they are public identifiers rather than credentials. No repository secret or mutable variable selects them.

## Relay boundary

`phishtopia-ops-controller.service` runs as unprivileged `phishtopia-mcp`. It uses the VM metadata server for a short-lived token and calls only the fixed Pub/Sub REST endpoints. It forwards only canonical worker protocol requests to the root-owned Unix socket. The worker remains the only component that performs mutations or accesses rollback material.

At startup, the relay uses `testIamPermissions` against only the fixed request
subscription and response topic. Readiness requires the exact consume and
publish permissions but does not pull, acknowledge, or publish a message.
Runtime uses bounded non-waiting pulls on a five-second idle cadence. This is
an intentional, low-rate use of Pub/Sub's documented but deprecated
`returnImmediately` field: an empty subscription must not turn Pub/Sub's
bounded unary wait into a false transport failure. If Google removes that field,
the fixed HTTP error mapping fails closed rather than reporting readiness.

The controller-aware bootstrap:

- reuses the existing verified Ops release installer;
- snapshots the prior relay unit, environment, enabled state, and active state;
- runs controller tests in a hardened transient unit;
- installs a root-owned systemd unit and root-only environment file;
- requires the relay to be active before controller-aware finalization;
- restores or removes all relay material during rollback;
- preserves the previous retained rollback baseline in a root-only retired archive.

## Failure behavior

- Unauthorized or malformed commands fail before cloud authentication.
- Duplicate deliveries map to the same idempotency key.
- The relay publishes the response before acknowledging the request.
- Failed response publication leaves the request unacknowledged for safe redelivery.
- GitHub workflows are serialized; stale responses are discarded by request ID.
- Provider errors, subprocess output, credentials, headers, secrets, raw logs, and database rows never enter issue comments.
- Controller-aware installation uses one bounded attempt and the existing exact recovery helper.

## Controlled activation

1. Merge only after normal CI passes.
2. Install the merged commit through `activate-external-controller-cloud-shell.sh`.
3. Verify worker, tunnel, controller, database fingerprint, and retained rollback baseline.
4. Submit a non-mutating transport probe.
5. Test one bounded reversible job and verify its durable record and sanitized response.

Merging alone does not install the relay or mutate production.
