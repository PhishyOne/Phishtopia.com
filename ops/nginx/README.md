# Resilient upstream error pages

These files provide branded `502`, `503`, and `504` responses at the Nginx layer. They do not depend on Express, PM2, sessions, PostgreSQL, or JavaScript.

## Repository files

- `public/__system-errors/502.html`
- `public/__system-errors/503.html`
- `public/__system-errors/504.html`
- `public/__system-errors/upstream-errors.css`
- `public/images/errors/502.webp`
- `public/images/errors/503.webp`
- `public/images/errors/504.webp`
- `ops/nginx/phishtopia-upstream-errors.conf`

The HTML documents are internal Nginx error targets. The logo and scene routes are exact static aliases so the browser can retrieve them while the application upstream is unavailable.

## Nginx integration

Install the reviewed snippet as a root-owned file and include it once inside the production HTTPS `server {}` block:

```nginx
include /etc/nginx/snippets/phishtopia-upstream-errors.conf;
```

Do not include it at `http {}` scope because it contains `location` directives.

## Activation checklist

1. Record the current Nginx configuration hash and copy the active site file to a root-only rollback path.
2. Install the reviewed snippet with owner `root:root` and mode `0644`.
3. Add the single `include` directive to the HTTPS server block.
4. Run `sudo nginx -t`.
5. Reload with `sudo systemctl reload nginx`.
6. Confirm `/`, `/health`, `/ready`, login, static assets, TLS, and redirects still work.
7. Verify the three internal HTML paths return `404` to direct public requests.
8. Verify the exact logo and scene asset paths return their expected image content types.
9. Perform a bounded local-only upstream-failure test or a separately approved short PM2 interruption with immediate health verification.

## Rollback

Restore the exact saved site file, remove the installed snippet if it was newly created, run `sudo nginx -t`, reload Nginx, and verify the normal public endpoints. Do not leave Nginx in a partially edited state.

## API limitation

When the upstream cannot respond, Nginx cannot ask Express whether the original request expected JSON. A true gateway failure therefore returns the static HTML page even for an API URL. Normal application-generated API errors remain structured JSON because Express still handles them.
