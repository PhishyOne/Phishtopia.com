# Error-page architecture

`src/config/errorPages.js` owns status-specific user-facing copy and safe API messages.

`src/middleware/errorResponses.js` negotiates the response format:

- HTML for browser page requests;
- JSON for API requests;
- plain text for missing static assets.

`src/middleware/notFoundHandler.js` handles final route fallthrough. `src/middleware/errorHandler.js` handles thrown failures and logs only server-side details for 5xx errors.

`views/errors/error.ejs` is the single reusable template. `public/styles/errors.css` owns the scoped underwater presentation and motion-reduction behavior.
