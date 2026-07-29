# Branded error-page system

The error-page implementation deliberately treats the generated underwater concepts as art direction rather than shipping them as full-page screenshots.

## Production approach

- Real EJS navigation, headings, links, status codes, and copy remain selectable, responsive, and accessible.
- The existing `/images/phishLogo.png` remains the only logo used by the shared header.
- The underwater scene is built from lightweight CSS gradients, metallic typography, bubbles, light rays, and status-specific inline SVG emblems.
- No generated navigation, text, buttons, or substitute logos are baked into an image.
- Motion is disabled when `prefers-reduced-motion` is enabled.

## Response behavior

- Browser page failures render the branded HTML template.
- API failures retain structured JSON.
- Missing static assets retain lightweight plain-text responses.
- Error responses are non-cacheable and excluded from search indexing.
- The 500 handler logs internal details but never sends them to the browser.

## Included statuses

- `403`: These waters are restricted.
- `404`: This page is off the map.
- `429`: Too many requests.
- `500`: Something stirred in the depths.
