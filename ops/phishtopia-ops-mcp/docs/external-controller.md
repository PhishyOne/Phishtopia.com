# External GitHub Ops controller

## Status

This is a reviewable design for Issue #15, not an active deployment. The ChatGPT Secure MCP app stays read-only. Activation requires the dedicated locked issue, narrowly scoped Pub/Sub resources, Workload Identity Federation, repository variables, and installation of the relay service through the verified Ops release process.

The dedicated command queue is issue `#43`. It was created and locked before activation; while this workflow remains unmerged or unconfigured, comments there have no production effect.

## Queue contract

Only a newly created owner comment on the configured, locked issue in `PhishyOne/Phishtopia.com` is accepted. The controller verifies immutable repository ID `997939289`, owner ID `123998606`, `author_association=OWNER`, issue number `43`, and the issue lock state. Bot comments are ignored to prevent response recursion.

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

The GitHub controller service account receives only:

- publish permission on the request topic;
- consume/acknowledge permission on the GitHub response subscription.

The existing VM service identity receives only these additional controller permissions:

- consume/acknowledge permission on the VM request subscription;
- publish permission on the response topic.

Do not grant Pub/Sub Admin, Project Editor/Owner, Compute Admin, OS Login, service-account-key creation, Secret Accessor, or SSH permissions. Workload Identity Federation binds the immutable repository ID, owner ID, workflow path, main branch, `issue_comment` event, and owner actor ID. No JSON service-account key is stored in GitHub.

Repository variables:

- `PHISHTOPIA_OPS_QUEUE_ISSUE`
- `PHISHTOPIA_OPS_WIF_PROVIDER`
- `PHISHTOPIA_OPS_CONTROLLER_SERVICE_ACCOUNT`

## Bounded cloud bootstrap

Run `scripts/bootstrap-external-controller.sh --queue-issue 43` only from a reviewed, commit-pinned checkout. The script:

- stops on the first failed prerequisite or unexpected existing resource;
- discovers and verifies the fixed VM service account;
- creates or verifies the controller service account, two topics, and two subscriptions;
- applies only resource-level Pub/Sub grants;
- creates or strictly verifies the GitHub OIDC provider;
- binds only repository ID `997939289` to the controller service account;
- performs a final IAM verification pass;
- prints the three non-secret repository-variable values.

It does not deploy code, install the relay, restart the VM or services, alter DNS, access secret payloads, create a service-account key, or submit an Ops job. Re-running the script is idempotent when the existing resources exactly match the policy. It refuses to rewrite an unexpected provider.

## Relay boundary

`phishtopia-ops-controller.service` runs as unprivileged `phishtopia-mcp`. It uses the VM metadata server for a short-lived token and calls only the fixed Pub/Sub REST endpoints. It forwards only canonical worker protocol requests to the root-owned Unix socket. The worker remains the only component that performs mutations or accesses rollback material.

## Failure behavior

- Unauthorized or malformed commands fail before cloud authentication.
- Duplicate deliveries map to the same idempotency key.
- The relay publishes the response before acknowledging the request.
- Failed response publication leaves the request unacknowledged for safe redelivery.
- GitHub workflows are serialized; stale responses are discarded by request ID.
- Authentication, setup, transport, and posting failures produce only a stable issue response and bounded Actions diagnostic.
- Provider errors, subprocess output, credentials, headers, secrets, raw logs, and database rows never enter issue comments.

## Controlled activation

1. Keep PR #42 draft while review and normal CI complete.
2. Keep issue #43 locked and unused.
3. Run the bounded cloud bootstrap and preserve only its final non-secret output block.
4. Configure the three repository variables from that output.
5. Merge only after the branch is reviewed and CI is green.
6. Install the relay source, environment file, and systemd unit through the verified Ops release process.
7. Verify the worker socket and relay health without submitting a mutation.
8. Submit a status-only command.
9. Test one bounded reversible job and verify its durable record and sanitized response.

Until those steps are completed, production remains unchanged.
