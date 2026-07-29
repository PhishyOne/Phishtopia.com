# Security notes

- Client responses never include exception messages, stack traces, database details, secret values, or internal paths.
- API requests retain structured JSON errors.
- Error pages send `Cache-Control: no-store` and `X-Robots-Tag: noindex, nofollow`.
- Retired route prefixes remain blocked before static or application routing.
