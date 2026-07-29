# Error-page verification

## Automated

- Confirm unknown browser routes return branded HTML with status 404.
- Confirm retired routes remain blocked and use the branded 404.
- Confirm missing API routes return JSON rather than HTML.
- Confirm missing static assets return lightweight plain text.
- Confirm 403, 429, and 500 status-specific copy and content types.
- Confirm browser and API 500 responses do not expose internal error details.
- Confirm authentication rate limiting reaches the branded 429 response.
- Confirm the new stylesheet is declared, referenced, and served as CSS.

## Manual before merge

- Check 404 on a narrow Android viewport and desktop viewport.
- Verify navigation wrapping, button tap targets, and readable contrast.
- Verify bubbles and light rays remain subtle.
- Enable reduced-motion mode and verify animation stops.
- Verify Home and Projects links work.
- Trigger a disposable authentication rate limit only in an isolated preview or test environment.
