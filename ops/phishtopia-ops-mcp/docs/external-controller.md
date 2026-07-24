# External GitHub Ops controller

## Status

This is a reviewable design for Issue #15, not an active deployment. The ChatGPT Secure MCP app stays read-only. Activation requires a dedicated locked issue, repository variables, narrowly scoped Pub/Sub resources, Workload Identity Federation, and installation of the relay service through the verified Ops release process.

## Queue contract

Only a newly created owner comment on one configured, locked issue in `PhishyOne/Phishtopia.com` is accepted. The controller verifies immutable repository ID `997939289`, owner ID `123998606`, `author_association=OWNER`, the exact issue number, and the issue lock state. Bot comments are ignored to prevent response recursion.

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

The GitHub controller service account should have only:

- publish permission on the request topic;
- consume/acknowledge permission on the GitHub response subscription.

The VM service identity should have only:

- consume/acknowledge permission on the VM request subscription;
- publish permission on the response topic.

Do not grant Pub/Sub Admin, Project Editor/Owner, Compute Admin, OS Login, service-account-key creation, Secret Accessor, or SSH permissions. Workload Identity Federation must bind the immutable repository ID and exact workflow identity. No JSON service-account key is stored in GitHub.

Repository variables:

- `PHISHTOPIA_OPS_QUEUE_ISSUE`
- `PHISHTOPIA_OPS_WIF_PROVIDER`
- `PHISHTOPIA_OPS_CONTROLLER_SERVICE_ACCOUNT`

## Relay boundary

`phishtopia-ops-controller.service` runs as unprivileged `phishtopia-mcp`. It uses the VM metadata server for a short-lived token and calls only the fixed Pub/Sub REST endpoints. It forwards only canonical worker protocol requests to the root-owned Unix socket. The worker remains the only component that performs mutations or accesses rollback material.

## Failure behavior

- Unauthorized or malformed commands fail before cloud authentication.
- Duplicate deliveries map to the same idempotency key.
- The relay publishes the response before acknowledging the request.
- Failed response publication leaves the request unacknowledged for safe redelivery.
- GitHub workflows are serialized; stale responses are discarded by request ID.
- Provider errors, subprocess output, credentials, headers, secrets, raw logs, and database rows never enter issue comments.

## Controlled activation

1. Merge only after normal CI passes.
2. Create and lock the dedicated queue issue.
3. Create the two topics and two subscriptions.
4. Apply the narrow IAM grants above.
5. Configure Workload Identity Federation with immutable repository/workflow conditions.
6. Add the three repository variables.
7. Install the relay source and systemd unit through the verified Ops release process.
8. Verify the worker socket, relay health, and a status-only command.
9. Test one bounded reversible job and verify its durable record and sanitized response.

Until those steps are completed, production remains unchanged.
