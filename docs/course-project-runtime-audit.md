# Course-project runtime audit

Audit baseline: `41185ae7dc000bb4e05f4e286e1808114237a2ba`

Isolation baseline after PR #58: `3c33ab90ba55a0986b442dc255127234376b58c3`

Archive source: [`archive/course-projects-2026-07-28`](https://github.com/PhishyOne/Phishtopia.com/tree/archive/course-projects-2026-07-28)

## Runtime findings and corrections

| Area | Finding at the audit baseline | Final correction |
|---|---|---|
| `app-brewery-server` | No active import or router dependency remained. | Removed the entire compatibility and course-project tree from `main`; the archive branch retains it. |
| `/static` | No active route existed, but the retired course-progress tree remained in `views/app-brewery-static`. | Preserved its manifest and screenshots through the archive branch, removed the tree from `main`, and retained the public-prefix block. |
| `/projectXX` | Page routes were retired, but project-number views and some directly servable assets remained. | Removed the retired view trees and the remaining root `public/project34` tree; known retired prefixes continue to return 404. |
| `project34` | Server-side YouList paths were canonical, but the browser fallback still used `/project34/images/placeholder.png`. | Changed the fallback to `/images/youlist-placeholder.jpg`, removed the old view and asset tree, and added regression assertions. |
| `player-int` | EchoTrace still rendered and loaded files named after the old alias. | Moved the live template and assets to canonical EchoTrace paths and removed the old files. |
| Course-progress stylesheet | `/styles/app-brewery.css` served only the retired manifest. | Removed it with the retired course-progress tree. |
| Obsolete refactor plan | `docs/REFACTOR_PLAN.md` instructed maintainers to keep legacy projects live. | Removed it and replaced the original inventory with the current cleanup status. |

## Removed from `main`

- `app-brewery-server/`
- `views/app-brewery-static/`
- `views/project25/`
- `views/project28/`
- `views/project29/`
- `views/project30/`
- `views/project33-1/`
- `views/project33-2/`
- `views/project33-3/`
- `views/project34/`
- `public/project34/`
- `public/styles/app-brewery.css`
- `docs/REFACTOR_PLAN.md`

The complete versions of those files remain reachable through the archive branch and the links in `docs/course-project-archive.md`.

## Active feature dependency result

- **YouList:** renders `views/youlist/index.ejs`; uses `public/styles/youlist*.css`, `public/js/youlist.js`, and `/images/youlist-placeholder.jpg`.
- **EchoTrace:** mounts only at `/echotrace`; renders `views/echotrace/index.ejs`; uses `/styles/echotrace.css`, `/js/echotrace.js`, and `/js/echotrace-logo.js`.
- **StoreCalc:** renders `views/storecalc/index.ejs` with no course-project route or asset dependency.
- **Authentication:** login, registration, resend-verification, verification, and check-email flows contain no course-project path dependency.
- **Analytics:** remains isolated under `/internal/analytics` with no retired imports or asset URLs.
- **Home and contact:** explicit routes render `views/index.ejs` and `views/contact.ejs`; their templates and shared partials contain no retired local URLs.

The bare `player-int` string remains temporarily as an internal CSS body-class namespace used by EchoTrace and `main.css`. It is not a route, filename, import, public URL, or course-project asset dependency.

## Regression coverage

- `test/runtime-boundaries.test.js` checks the active source boundary, canonical YouList and EchoTrace paths, archive preservation, rendered pages, canonical feature assets, and 404 behavior for retired public paths.
- `test/course-project-removal.test.js` checks that the retired source trees and standalone files are absent from the working repository while archive links continue to target the preserved branch.
