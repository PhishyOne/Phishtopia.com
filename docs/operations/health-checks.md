# Health and readiness checks

Phishtopia exposes two intentionally different unauthenticated checks.

## `GET /health`

`/health` is a process-liveness check. It confirms that the Node/Express process can answer HTTP requests. It does not contact PostgreSQL or any third-party service.

Use it for:

- basic uptime checks
- confirming that a deployment started the application process
- PM2 or container liveness checks that should not restart the process solely because PostgreSQL is temporarily unavailable

A healthy process returns HTTP `200` with `status: "ok"`.

## `GET /ready`

`/ready` is a dependency-aware traffic-readiness check. It runs exactly `SELECT 1` against PostgreSQL and applies a fixed 1.5-second deadline. It intentionally does not probe TMDB, Cloudflare, email delivery, or other external services that are not required to serve core database-backed requests.

It returns:

- HTTP `200` with `status: "ready"` when PostgreSQL responds
- HTTP `503` with `status: "not_ready"` when PostgreSQL rejects, is not configured, or does not respond before the deadline

The response is marked `Cache-Control: no-store`. Database errors, connection details, credentials, and stack traces are never included. Automated clients should treat every non-`200` response, connection failure, or malformed response as not ready.

Use `/ready` for:

- deployment verification after the process starts
- canary promotion and traffic-switch decisions
- load-balancer or Cloud Run readiness checks
- monitoring that must distinguish a live process from an application that can actually serve database-backed requests

## Example checks

```bash
curl --fail --silent --show-error https://phishtopia.com/health
curl --fail --silent --show-error https://phishtopia.com/ready
```

A `503` from `/ready` should block new traffic or promotion, but it should not by itself prove that the Node process needs to be restarted. Check `/health` and the PostgreSQL service separately before taking recovery action.
