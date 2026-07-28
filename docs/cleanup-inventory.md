# Phishtopia cleanup status

This document replaces the original preservation-first cleanup inventory with the current state after the course-project archive and deletion passes.

Archive source: [`archive/course-projects-2026-07-28`](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28)

Readable archive: [`docs/course-project-archive.md`](course-project-archive.md)

Runtime audit: [`docs/course-project-runtime-audit.md`](course-project-runtime-audit.md)

## Completed

- Preserved the complete pre-cleanup repository on the dedicated archive branch.
- Preserved the original course-project titles, descriptions, routes, screenshots, and source links in a lightweight Markdown archive.
- Replaced generic page discovery and legacy route aggregation with explicit production routers.
- Retired `/projects`, `/static`, `/player-int`, `/playerint`, `/project25`, `/project28`, `/project29`, `/project30`, `/project33-1`, `/project33-2`, `/project33-3`, and the old project-number YouList paths.
- Moved YouList to canonical `views/youlist`, `/styles/youlist*.css`, `/js/youlist.js`, and `/images/youlist-placeholder.jpg` paths.
- Moved EchoTrace to canonical `views/echotrace`, `/styles/echotrace.css`, `/js/echotrace.js`, and `/js/echotrace-logo.js` paths.
- Removed the retired `app-brewery-server`, course-progress tree, project-number views, old YouList asset tree, and obsolete course stylesheet from `main`.
- Kept retired public prefixes blocked as defense in depth against accidental future reintroduction.
- Added regression coverage for active runtime boundaries, canonical feature assets, archive preservation, retired-route 404 behavior, and absence of deleted source trees.

## Active production surface

- Home
- Contact
- Authentication and email verification
- YouList
- EchoTrace
- StoreCalc
- Internal analytics
- Health and readiness endpoints
- Ops controller and worker infrastructure

## Remaining work under issue #56

1. Inventory every asset used by the surviving templates and routes.
2. Move remaining shared font declarations into documented canonical stylesheets.
3. Identify duplicate or orphaned files inside the surviving `public` feature areas.
4. Expand asset tests to verify declared local CSS, JavaScript, image, and font URLs return the expected content type.
5. Deploy the reduced tree and smoke-test the active production surface before removing any temporary compatibility guard that still adds value.

## Guardrails

- Do not rewrite or delete `archive/course-projects-2026-07-28`.
- Do not restore retired course files to `main`; link to the archive branch instead.
- Do not introduce a bundler or frontend framework merely to reorganize static files.
- Keep cleanup changes small, reversible, covered by tests, and separated from visual redesigns or new StoreCalc feature development.
