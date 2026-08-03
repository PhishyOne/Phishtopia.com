# StoreCalc anonymous calculation boundary

This directory completes the server boundary portion of StoreCalc delivery
slice 4 without activating an unreviewed public calculator.

`createAnonymousCalculationRouter()` builds the future
`POST /storecalc/api/v1/calculate` route. It accepts only an exact versioned
request containing public facility/template/audience selection keys, the
expected sealed configuration hash, an explicit context date, bounded
quantities, and optional private available funds. The client cannot submit a
configuration or totals.

The route is uncompressed UTF-8 JSON only, limited to 128 KiB, rate-limited to
30 requests per minute per address, and returns `private, no-store` with no
indexing or content sniffing. It creates no record, session state, cookie, or
analytics event, and it never logs request bodies or private inputs. Structural
calculation errors return bounded codes and paths without rejected values.
Ordinary infrastructure may still record the route, response status, timing,
and other non-body access metadata.

The catalog registry verifies sealed hashes and engine capabilities when it is
built, rejects overlapping effective intervals, and resolves one exact public
configuration by facility, template, audience, and context date. Unknown
selections all return the same `catalog_unavailable` response. A mismatched
client hash returns `configuration_stale` without disclosing a replacement
hash.

`publicRegistry.js` is deliberately empty. The router is deliberately not
mounted in the application. Synthetic fixtures exercise the complete HTTP
contract in tests, but never enter the production registry. A separate reviewed
change must add a source-backed facility catalog, prove applicability, register
its sealed configuration, mount the route before the application-wide JSON
parser, and unlock the accessible browser workflow.
