# Phishtopia cleanup inventory

This document defines the initial scope for the course-project archive, legacy-route removal, and stabilization work. It is intentionally conservative: preserve first, remove from production second, then harden the smaller application.

## Working rules

- `main` remains untouched until preservation is verified.
- Archive or tag the current course-project state before deleting production code.
- Capture screenshots and short notes for worthwhile course projects before removal.
- Active production code belongs under `src/`, `views/`, and `public/` in clearly owned feature areas.
- Nothing under `app-brewery-server/` should remain a runtime dependency after cleanup.
- StoreCalc feature development stays deferred until stabilization is complete.

## KEEP

| Route / area | Decision | Notes |
|---|---|---|
| `/` | Keep | Replace the current project-oriented homepage later with a simple interactive navigation hub. |
| `/auth/*` | Keep and harden | Registration, login, logout, verification, sessions, authorization, validation, redirects, CSRF, and account security need stabilization. |
| `/youlist/*` | Keep and harden | Fix stored-XSS exposure, pagination/counting, constraints, API auth responses, validation, and tests. |
| `/echotrace/*` | Keep and migrate | One canonical route only. Move remaining active implementation out of legacy root-level locations into a production feature area. |
| `/internal/analytics/*` | Keep and harden | Preserve the working report flow; verify authentication, Scheduler, secrets, and Cloud Run behavior. |
| `/storecalc/*` | Keep placeholder only | Do not continue feature work until cleanup and stabilization are complete. |
| Health endpoint | Keep and improve | Preserve process-health reporting and later add production-appropriate readiness behavior. |

## ARCHIVE, THEN REMOVE FROM PRODUCTION

| Route | Current source | Decision |
|---|---|---|
| `/project25` | `app-brewery-server/routes/project25.js` | Archive screenshots/notes/source state, then remove route and active assets. |
| `/project28` | `app-brewery-server/routes/project28.js` | Archive screenshots/notes/source state, then remove route and active assets. |
| `/project29` | `app-brewery-server/routes/project29.js` | Archive screenshots/notes/source state, then remove route and active assets. |
| `/project30` | `app-brewery-server/routes/project30.js` | Archive screenshots/notes/source state, then remove route and active assets. |
| `/project33-1` | `app-brewery-server/routes/project33-1.js` | Archive screenshots/notes/source state, then remove route and active assets. |
| `/project33-2` | `app-brewery-server/routes/project33-2.js` | Archive screenshots/notes/source state, then remove route and active assets. |
| `/project33-3` | `app-brewery-server/routes/project33-3.js` | Archive screenshots/notes/source state, then remove route and active assets. |
| `/simon` | `views/simon.ejs` plus `/styles/simon.css` and `/js/simon.js` | Archive the working game visually and remove it from production routing/assets. |
| `/intm-logo` | `views/intm-logo.ejs` plus `/styles/logo.css` and `/js/logo.js` | Archive the animation visually and remove it from production routing/assets. |
| `/static` | Course-progress/course-project content linked from the site | Locate the exact source/assets, capture them, then remove the production link and route/content. |
| `/projects` page | `views/projects.ejs` plus navigation/styles | Preserve a screenshot if useful, then remove. The future site does not need a projects page. |

## REVIEW BEFORE FINAL PUBLIC-SITE DECISION

| Route / area | Question |
|---|---|
| `/contact` | Keep only if a standalone contact page still adds value after the homepage/header redesign; otherwise fold contact information into the homepage/footer. |
| Current footer course-progress link | Remove with `/static`; replace only with links that serve the smaller production site. |

## DELETE OR REPLACE DURING CLEANUP

| Item | Decision | Reason |
|---|---|---|
| `/player-int` | Delete alias | EchoTrace will use `/echotrace` exclusively; the site has no compatibility requirement. |
| `src/routes/legacy.routes.js` | Delete after migration/removal | It exists only to combine EchoTrace with retired course projects and aliases. |
| Generic filesystem-driven page routing | Replace with an explicit allowlist/router | Scanning every top-level EJS file can accidentally publish templates such as login, registration, or status views. |
| `app-brewery-server/db.js` compatibility shim | Delete after all legacy imports are gone | It merely re-exports `src/db/pool.js` and should not remain part of the production dependency graph. |
| Old course-project navigation links | Delete | The redesigned header/footer will link only to active tools and account functions. |
| Course-project-specific production assets | Remove after preservation | They should not enlarge the deployed image or attack surface after archival. |
| Homepage links to `/projects` and `/player-int` | Replace | The current homepage still centers the retired project collection and old EchoTrace alias. |
| Header “Projects Showcase” dropdown | Replace | Current navigation points to `/player-int`, `/projects`, and the old project-oriented site structure. |
| Footer `/static` course-progress link | Delete | Course progress will no longer be a live production feature. |

## MIGRATE BEFORE DELETE

- Move the active EchoTrace router, controllers/services, views, and assets into an explicit production feature boundary under `src/`, `views/`, and `public/`.
- Identify every remaining import from `app-brewery-server/` and either migrate the required code or remove the retired feature.
- Replace the current dynamic view scanner with explicit public routes.
- Update the header, footer, homepage links, sitemap/canonical metadata, and 404 behavior after route removal.

## Preservation checklist

For each course project worth retaining:

1. Record the original route and project name.
2. Capture one clean overview screenshot and, where useful, one feature screenshot and one mobile screenshot.
3. Record the course/assignment context, technologies, key behavior, and known limitations.
4. Preserve the current source through the repository history plus a dedicated archive branch or tag.
5. Verify that project-specific assets and explanatory notes are included before production deletion.

The polished public portfolio/archive page is a later project. Preservation must not block the security stabilization phase longer than necessary.

## Stabilization order after preservation

1. Remove course projects, `/player-int`, `/projects`, and obsolete navigation.
2. Move EchoTrace and any other active runtime code out of legacy locations.
3. Replace generic page discovery with explicit routing.
4. Fix confirmed security vulnerabilities, beginning with XSS, session-secret enforcement, session regeneration, safe redirects, CSRF/origin protection, cookie policy, and verification-token handling.
5. Fix correctness/state issues and add regression tests.
6. Add migrations, CI checks, production-safe logging, API timeouts/rate limits, graceful shutdown, and documented configuration.
7. Verify deployment, database, Cloudflare, Scheduler, analytics, backups, and secrets.
8. Resume StoreCalc.
9. Redesign the homepage, header, and footer around the smaller set of active tools.
10. Build the interactive animated homepage after StoreCalc.

## Current public-site target

- Home
- YouList
- EchoTrace
- StoreCalc
- Login / account functions
- Any future production-ready tools

No general Projects page is planned for the redesigned site.
