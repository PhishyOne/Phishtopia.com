# Frontend asset conventions

Phishtopia uses Express static files directly. There is no bundler or frontend build pipeline.

## Canonical locations

- `public/styles/main.css`: site-wide design tokens, typography, navigation, forms, shared layout, and shared components.
- `public/styles/<feature>.css`: page-specific styles for an active feature.
- `public/js/<feature>.js`: browser behavior owned by an active feature.
- `public/images/`: shared and active feature images referenced by production templates or browser code.
- `public/fonts/`: locally hosted font files.
- `public/.well-known/`: reviewed standards-based static resources such as `security.txt`, served through the dedicated `/.well-known` mount.
- `public/__system-errors/`: self-contained static HTML and CSS used by Nginx when the Node application cannot answer.
- `src/config/pageAssets.js`: the canonical title, body class, stylesheet list, and script list for each rendered page.

Do not add new files under project-number directories, `app-brewery-server`, or `views/app-brewery-static`. Those sources are preserved only on `archive/course-projects-2026-07-28`.

## Page rendering

Routes and controllers call `pageLocals(pageName, values)` when rendering an EJS page. Templates include the shared header and footer without supplying their own titles, body classes, stylesheets, or scripts.

Add a new page definition before mounting a new rendered route. Do not recreate `extraStyles` or `extraScripts` arrays inside a controller or template.

The shared branded error template is rendered through `src/middleware/errorResponses.js`. It uses the normal header and footer, while API and static-asset failures keep lightweight non-HTML responses. Supported cinematic pages receive their scene URL in the initial server-rendered HTML; `/js/error-scenes.js` remains only as a fallback. Express currently has dedicated cinematic definitions for `400`, `403`, `404`, `405`, `410`, `429`, and `500`.

Nginx upstream failures use the static files in `public/__system-errors/` plus the matching `/images/errors/502.webp`, `/images/errors/503.webp`, and `/images/errors/504.webp`. Their reviewed include lives at `ops/nginx/phishtopia-upstream-errors.conf`. These pages must not depend on Express, EJS, JavaScript, remote fonts, or third-party assets.

## Current active inventory

### Styles

- `/styles/main.css`
- `/styles/archive.css`
- `/styles/errors.css`
- `/styles/errors-cinematic.css`
- `/styles/youlist.css`
- `/styles/youlist-mobile.css`
- `/styles/echotrace.css`

### JavaScript

- `/js/auth.js`
- `/js/canvas.js`
- `/js/echotrace-logo.js`
- `/js/echotrace.js`
- `/js/error-scenes.js`
- `/js/register.js`
- `/js/youlist.js`

### Images

- `/images/discord.svg`
- `/images/errors/400.webp`
- `/images/errors/403.webp`
- `/images/errors/404.webp`
- `/images/errors/405.webp`
- `/images/errors/410.webp`
- `/images/errors/429.webp`
- `/images/errors/500.webp`
- `/images/errors/502.webp`
- `/images/errors/503.webp`
- `/images/errors/504.webp`
- `/images/logoBG.jpg`
- `/images/phishLogo.png`
- `/images/share-card.png`
- `/images/youtube.svg`
- `/images/youlist-placeholder.jpg`

### Fonts

- `/fonts/evealpha-bold.ttf`

EchoTrace also loads Shentox from CCP's public webfont host. Its `@font-face` declaration belongs in `public/styles/echotrace.css`, not in the shared EJS header.

## Rules for future pages

1. Reuse `main.css` before adding another override file.
2. Give each active feature one canonical CSS file and one canonical JavaScript file unless a real separation is justified.
3. Put local font files under `public/fonts`, never under `public/styles`.
4. Use root-relative URLs such as `/styles/tool.css` and `/images/tool-icon.svg`.
5. Declare rendered-page metadata and assets in `src/config/pageAssets.js`.
6. Add every production asset to `test/asset-content-types.test.js`. The test verifies the complete inventory and expected HTTP content types.
7. Remove an asset from the inventory in the same PR that removes its final production reference.
8. Keep third-party URLs explicit and feature-scoped. Do not copy external assets into the repository without checking licensing and maintenance cost.
9. Keep Nginx fallback pages self-contained and validate the include with `nginx -t` before any reload.
10. Put standards-based static resources only in `public/.well-known/`. Keep the dedicated mount narrowly scoped; never enable generic serving of dotfiles or add filesystem-driven dynamic routing.
