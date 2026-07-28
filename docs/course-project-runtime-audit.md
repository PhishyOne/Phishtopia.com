# Course-project runtime audit

Audit baseline: `41185ae7dc000bb4e05f4e286e1808114237a2ba`

Archive source: [`archive/course-projects-2026-07-28`](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28)

## Findings and corrections

| Area | Finding at baseline | Correction in this cleanup |
|---|---|---|
| `app-brewery-server` | No active import or router dependency remained. References were limited to documentation and the retired course-progress manifest. | Added regression coverage preventing new runtime imports or URL references. |
| `/static` | No active route existed, but the retired manifest still linked the old front-end projects. | Preserved the manifest in `docs/course-project-archive.md` and blocked `/static` before the public static server. |
| `/projectXX` | Page routes were retired, but files under `public/projectXX` could still be fetched directly through the general public directory. | Blocked the known retired project prefixes before `express.static(publicDir)`. |
| `project34` | The server-side YouList fallback was canonical, but `public/js/youlist.js` still used `/project34/images/placeholder.png`. | Changed the browser fallback to `/images/youlist-placeholder.jpg` and added a regression assertion. |
| `player-int` | EchoTrace still rendered `views/player-int.ejs` and loaded `player-int.css`, `player-int.js`, and `little-logo.js`. | Moved the live template to `views/echotrace/index.ejs`, moved browser assets to canonical EchoTrace filenames, and removed the old files. |
| `public/projects` mount | `/projects/assets` still had a dedicated static mount even though no active template referenced it. | Removed `projectAssetsDir` and the dedicated mount. The retired `/projects` prefix is now blocked. |

## Active feature dependency check

- **YouList:** renders `views/youlist/index.ejs`; uses `public/styles/youlist*.css`, `public/js/youlist.js`, and `/images/youlist-placeholder.jpg`. No active `project34` dependency remains.
- **EchoTrace:** mounts only at `/echotrace`; renders `views/echotrace/index.ejs`; uses `/styles/echotrace.css`, `/js/echotrace.js`, and `/js/echotrace-logo.js`. The bare `player-int` string remains only as a temporary CSS body-class namespace shared with `main.css`; it is not a route, file path, import, or retired course asset dependency.
- **StoreCalc:** renders `views/storecalc/index.ejs` with no course-project route or asset dependency.
- **Authentication:** login, registration, resend-verification, and check-email templates are explicit top-level application views with no course-project path dependency.
- **Analytics:** registered only under `/internal/analytics`; its route and service graph contains no course-project imports or asset URLs.
- **Home and contact:** explicit routes render `views/index.ejs` and `views/contact.ejs`; their active templates and shared partials contain no retired local URLs.

## Deliberately not deleted in this patch

Retired source and asset directories may still exist in the main branch until the next deletion pass. They are no longer active dependencies, and known retired public URL prefixes are blocked. The archive branch remains the authoritative complete snapshot before those files are removed from `main`.

The regression test `test/runtime-boundaries.test.js` checks the active source boundary, canonical YouList and EchoTrace paths, archive preservation, rendered public pages, canonical EchoTrace assets, and 404 behavior for retired public paths.
