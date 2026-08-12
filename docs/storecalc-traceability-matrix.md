# StoreCalc Traceability Matrix

Issues: #111, #109

## Status

This matrix maps every normative requirement in
`storecalc-implementation-contract.md` to its primary enforcement and
verification boundary. It is authoritative together with that contract.

Abbreviations:

- **DB**: PostgreSQL schema, key, check, trigger, grant, or database test.
- **Svc**: server-side domain/application service.
- **Route**: HTTP contract and middleware.
- **Worker**: durable asynchronous or maintenance process.
- **Ops**: migration, backup, restore, monitoring, or release control.
- **Gate**: launch gate in the implementation contract.

An implementation slice may mark a mapped control not yet applicable only when
the associated feature remains disabled by its gate.

## Foundation and data

| Requirement | DB / schema control | Service, route, worker, authorization | Verification / operations |
|---|---|---|---|
| SC-FND-001 | Public/private scope and immutable-history models | Public calculator and bounded owner services; honest response language | Product acceptance and non-endorsement checks |
| SC-FND-002 | Assignment, applicability, template, version, profile, resolution, and order lineage | Deterministic resolver | Resolver ambiguity and historical-lineage fixtures |
| SC-FND-003 | Persisted orders require user; anonymous calculations create no order row | Public calculate route; authenticated persistence routes | Anonymous-use and no-persistence integration tests |
| SC-FND-004 | Sealed triggers and append-only event tables | Correction/versioning services | Direct DB mutation rejection and history tests |
| SC-FND-005 | Independent evidence groups and separate demand projections | Confidence service excludes usage | Confidence-factor and duplicate-evidence tests |
| SC-FND-006 | Migrations remain slice-scoped | Server feature gates and separate PRs | CI, review, and post-merge verification per slice |
| SC-DAT-001 | Integer identities; hashed capability values | Viewer-scoped authorization ignores ID secrecy | Type and token-storage tests |
| SC-DAT-002 | `bigint` minor units, sign policy, and numeric checks | Exact-integer calculator; decimal-string API | Negative-input, signed-result, overflow, bound, and serialization tests |
| SC-DAT-003 | `date`, `timestamptz`, IANA timezone fields | Server-local context-date resolver | Timezone, valid-time, and system-time tests |
| SC-DAT-004 | Original and normalized bounded text fields | Unicode/code validation and escaped output | Unicode, bidi, byte/code-point, and search rebuild tests |
| SC-DAT-005 | Core relationships use FKs; JSONB has schema/size checks | Versioned payload validators | Unknown-schema and oversized-payload rejection |
| SC-DAT-006 | Schema/canonicalization/hash columns and uniqueness | Pure canonical serializer plus locked database extractor/sealer | Golden SQL/JavaScript hash parity and stale-diff/type/hash tests |
| SC-DAT-007 | Explicit value-state/nullability checks | Calculator fails closed on unknown/unsupported | Zero-vs-unknown-vs-unlimited tests |

## Database and accounts

| Requirement | DB / schema control | Service, route, worker, authorization | Verification / operations |
|---|---|---|---|
| SC-DB-001 | `storecalc` namespace; least-privilege grants; runtime roles do not own | Separate web, worker, migration, backup identities | Grant/owner snapshot tests in migration rehearsal |
| SC-DB-002 | Fixed-search-path functions; public execute revoked | No user-derived dynamic SQL | Definition, owner, search-path, and grant verification |
| SC-DB-003 | Restrictive FKs for historical parents; bounded draft cascades | Tombstone/archive/deletion services | Parent-cascade hostile tests |
| SC-DB-004 | Composite candidate keys and FKs | Same-lineage service errors | Cross-parent DB rejection matrix |
| SC-ACC-001 | Account status/security generation and checks | Every auth/token/session path reloads current state | Disabled/reactivated/stale-generation tests |
| SC-ACC-002 | Singleton owner assignment and last-owner restrictions | Database-backed owner guard | Concurrent transfer and last-owner tests |
| SC-ACC-003 | Support-case/token FKs, hash uniqueness, coherent states | Single-use recovery service | Cross-case, expiry, consume, revoke, and raw-token tests |
| SC-ACC-004 | Serialized account security aggregate and generation increment | Credential transition service; session regeneration; outbox | Concurrent link/recovery/role/status race tests |
| SC-ACC-005 | Support, idempotency, audit, factor metadata | Owner route guard with CSRF, rate limit, recent strong assertion | Strong-auth stale-session and action-class tests; Gate SC-GAT-005 |
| SC-ACC-006 | Append-only hashed audit events | Minimized audit writer and off-host anchoring worker | Mutation/removal/reorder detection and anchor restore tests |
| SC-ACC-007 | Bounded recovery artifact reference | Checksum-verified single-purpose break-glass command | Disposable rehearsal; no arbitrary target/operation tests |

## Contributor privacy and directory

| Requirement | DB / schema control | Service, route, worker, authorization | Verification / operations |
|---|---|---|---|
| SC-PRV-001 | Contributor subject survives nullable account link | Internal anti-abuse/trust identity | Account-deletion and re-registration tests |
| SC-PRV-002 | Explicit scope FKs and null pattern on attribution rows | Public attribution renderer; moderator-only resolution | Cross-facility unlinkability, wrong-scope, and metadata/API leak tests |
| SC-PRV-003 | Opt-out and minimized first-party event records; no raw IP/private context | Aggregate demand service; connection-country hint never gates or scores facts | Deduplication, opt-out, payload inventory, country-mismatch, and confidence-isolation tests |
| SC-USR-001 | Private settings row; composite selection lineage | Viewer-scoped settings service | Cross-user, invalid assignment/program/audience, analytics-exclusion, and deletion tests |
| SC-USR-002 | Private `(user, facility)` follow key | Viewer-scoped follow and classified merge service | Duplicate, cross-user enumeration, merge, deletion, and history-preservation tests |
| SC-DIR-001 | Country-coherent composite FKs and cycle prevention | Directory write service | Cross-country parent/agency and cycle tests |
| SC-DIR-002 | Scope/owner checks, physical lineage FK, timezone allowlist, merge cycle check | Viewer-scoped facility service | Private enumeration, timezone, and merge-cycle tests |
| SC-DIR-003 | Append-only fact/merge events; current projection | Directory proposal/source services | Rename/closure/agency history and failed-source tests |
| SC-DIR-004 | Request state/support events and unique active positions | Request/provisional approval services; private attribution | Creator self-support, duplicate retry, and no-auto-publication tests |
| SC-DIR-005 | Historical FKs remain restrictive | Transactional classified merge service | Completed-order preservation and movable-record tests |

## Programs, applicability, and composition

| Requirement | DB / schema control | Service, route, worker, authorization | Verification / operations |
|---|---|---|---|
| SC-APP-001 | Program scope/owner checks; no facility owner FK | Program visibility service | One program assigned to multiple facilities |
| SC-APP-002 | Assignment composite keys and non-overlap enforcement | Public resolver requires exact facility/program/audience/date and never guesses among programs | Overlap, ambiguity, date-boundary, and independent-facility tests |
| SC-APP-003 | Exact-version/publication null-pattern and same-parent FKs | Public resolver returns exact version/publication lineage; scoped-profile composition remains deferred | Older-version-at-one-facility and lineage tests |
| SC-APP-004 | Append-only applicability proposal/review/evidence events | Applicability contribution routes and confidence service | Content/applicability independence and correction-history tests |
| SC-APP-005 | Resolution inputs/components/hashes persist | Bounded public base-version resolver returns exact inputs, intervals, lineage, contract, capabilities, and hash; viewer-scoped composition/persistence remains deferred | Ambiguous, withdrawn, invisible, unsupported, and date fixtures |
| SC-APP-006 | Immutable profile versions/deltas and compatibility range | Domain-specific composition service | Incompatible/conflicting profile and unsupported-gate tests |
| SC-APP-007 | Immutable resolved rows, visibility intersection, dependency graph | Dependency-aware cache/resolution service | Private-component cache leak, withdrawal, and cycle tests |

## Catalog and versions

| Requirement | DB / schema control | Service, route, worker, authorization | Verification / operations |
|---|---|---|---|
| SC-CAT-001 | Template scope/owner and fork composite FKs/cycle guard | Authorized copy/fork service | Private-source, self/cycle, and provenance-deletion tests |
| SC-CAT-002 | Stable keys and append-only identity events | Reviewed identity decision service | Fuzzy/SKU non-auto-match; split/merge/reversal history |
| SC-CAT-003 | Same-template ancestry; sealed header trigger; hash fields | Seal service locks one existing draft, extracts all canonical children, and compare-and-sets its hash | Cross-template base, cycle, concurrent number/seal/mutation, hash parity, and sealed-update tests |
| SC-CAT-004 | Same-template/version composite FKs and value/bounded-integer-quantity checks | Version item validator | Cross-version category, negative/zero/step, and unknown-price tests |
| SC-CAT-005 | Same-version membership FKs and bucket state checks | Parallel bucket calculator | Multi-bucket, excluded, unknown-limit, and non-summing tests |
| SC-CAT-006 | Scope null-pattern, same-version FKs, rate/rounding checks | One-effective-tax resolver | Ambiguous/stacked/inclusive/rounding-scope fixtures |
| SC-CAT-007 | Typed measure/comparator/unit/composition checks | Capability-aware constraint calculator | Quantity/count/weight/unit and unsupported-period tests |
| SC-CAT-008 | Warnings/source evidence sealed; later evidence append-only | Warning/evidence services plus seal-time evidence revalidation | Hash inclusion, ineligible-source rollback, and later-evidence non-mutation tests |
| SC-CAT-009 | Same-template publication FK; non-overlap; append-only events; assessment uniqueness | Serialized publication and confidence services preserve blocking component state | Concurrent/overlap/backdate, critical-component, and projection-rebuild tests |
| SC-CAT-010 | Exactly-one explicit target FK; translation binds source hash/version and state | Translation review/rendering service | Wrong-target lineage, source-change staleness, and canonical-fact invariance |

## Calculation and orders

| Requirement | DB / schema control | Service, route, worker, authorization | Verification / operations |
|---|---|---|---|
| SC-CAL-001 | Engine/version metadata stored | One pure core used by every caller | Caller parity and no clock/DB/network dependency tests |
| SC-CAL-002 | Persist exact output/snapshot fields; unsupported fee capability cannot imply zero | Server accepts inputs, never totals | Client-total tampering, unsupported-fee, and full-output contract tests |
| SC-CAL-003 | Composition vocabulary checked | Deterministic rule compositor | Random rule-order and equal-specificity conflict tests |
| SC-CAL-004 | Required-capability metadata | Resolver/calculator/publication fail closed | Capability mismatch and honest unsupported-state tests |
| SC-CAL-005 | Context date/timezone/source stored | Server timezone default and explicit recalc flow | Browser-clock, future, historical, and resumed-draft tests |
| SC-CAL-006 | Nullable nonnegative private funds with currency checks | Separate affordability calculation | Null, negative-input rejection, negative remaining, privacy, and no-FX tests |
| SC-CAL-007 | Validation severity/code rows | Draft/finalization language and policy | Unknown-rule and facility-acceptance wording tests |
| SC-CAL-008 | Fixture metadata/versioning | Test-only pure-core harness | Golden/property/overflow/regression/hash suite |
| SC-ORD-001 | Anonymous state has no persisted order row | Exact-version import/recalc route | No silent substitution and shared-device clear tests |
| SC-ORD-002 | Composite order lineage and exact monetary/provenance columns | Viewer-scoped order service | Cross-lineage and server-recalculation tests |
| SC-ORD-003 | Exact-version line FKs; sealed bucket/validation children | Calculation persistence service | Cross-version line and overlapping-bucket snapshots |
| SC-ORD-004 | Revision/idempotency uniqueness and completed-order trigger | Locked save/completion service | Stale save, double completion, and post-completion mutation tests |
| SC-ORD-005 | Export identity references sealed order | Escaped export/print worker; authorized downloads | Formula injection, funds omission, and reproduction tests |

## Evidence and community review

| Requirement | DB / schema control | Service, route, worker, authorization | Verification / operations |
|---|---|---|---|
| SC-EVD-001 | Private upload ownership, lineage, state, generation | Quarantine and extraction services | Cross-user, cross-facility, and lifecycle tests |
| SC-EVD-002 | Bounded metadata and object states | Signature scanner; isolated delivery; upload route bounds | Active/polyglot/sniffing/header/browser tests |
| SC-EVD-003 | Evidence groups/events and artifact lineage | Independence classifier with reviewed overrides | Duplicate/derivative/mirror/non-independent tests |
| SC-EVD-004 | Explicit redistribution/artifact states and tombstones | Publication/withdrawal service and cache invalidator | Private-to-public transition and post-public withdrawal tests |
| SC-EVD-005 | URL is bounded inert data | Safe renderer; optional SSRF-hardened worker | Scheme, redirect, rebinding, size/time, private-network tests |
| SC-EVD-006 | Object manifest tied to DB recovery point | Backup/reconcile/restore workers | Missing/orphan/private/public/withdrawn restore rehearsal |
| SC-REV-001 | Same-template base/candidate FKs; unique candidate; append-only state | Proposal submit/revise/resolve service | Stale diff, cross-template, and reopen rejection |
| SC-REV-002 | Append-only events; target-version FKs; deferred reason constraint | Review position service; self-review guard | Verdict history, no reason, self-review, resolved-proposal tests |
| SC-REV-003 | Separate exact version/applicability report targets, reasons, hashes, and append-only state events | Correction/applicability report services | Wrong target/date/audience/hash and replacement-history tests |
| SC-REV-004 | Exactly-one explicit report target FK; bounded comment audit events | Viewer-aware reporting and escaped/redactable comments | Orphan/private-target/non-enumeration, edit/redaction, and XSS tests |
| SC-REV-005 | Rebuildable scoped projections grant no permissions | Confidence/trust service excludes self/usage/duplicates | Self-amplification, new-account, projection rebuild tests |
| SC-REV-006 | Append-only withdrawal state/tombstone | Emergency withdrawal and dependency/cache worker | New-use block, no silent fallback, completed-history preservation |

## Security and state

| Requirement | DB / schema control | Service, route, worker, authorization | Verification / operations |
|---|---|---|---|
| SC-SEC-001 | Ownership/scope columns and restrictive queries | Viewer-scoped repository/service; uniform outward errors | ID enumeration, count, timing, conflict, and cache tests |
| SC-SEC-002 | State/idempotency constraints back routes | CSRF/origin/content-type/auth/status/rate middleware | Cross-site mutation tests for every route class |
| SC-SEC-003 | Principal-scoped idempotency unique key and payload hash | Replay/conflict service | Cross-user/operation/target/revision/payload and committed-retry tests |
| SC-SEC-004 | Bounded columns and index-supported pagination | Per-action quotas and deterministic cursors | Maximum-bound, spam, deep-page, and unlimited-key tests |
| SC-SEC-005 | No private context in public tables/cache projections | Redacted logs, analytics, referrers, emails, cache policy | Header/log/analytics/URL/count leak tests |
| SC-SEC-006 | Key/version references and least-privilege grants | TLS, managed-secret, rotation/revocation procedures | Encrypted backup restore and secret-rotation rehearsal |
| SC-STM-001 | Event tables, expected state/generation, projection constraints | Locked transition services | Invalid/skipped/repeated/backward transition matrix |
| SC-STM-002 | Core edge checks and append-only intervals | Named reversal workflows only | Per-state-machine acceptance and direct DB tests |
| SC-STM-003 | Row/advisory locks plus unique final defenses | Transaction services use fixed lock order; catalog sealing takes the shared migration lock before the version topology lock | Concurrent seal/mutation, promotion, merge, completion, deletion, hold, and migration tests |

## Notifications, async, deletion, and routes

| Requirement | DB / schema control | Service, route, worker, authorization | Verification / operations |
|---|---|---|---|
| SC-NOT-001 | Private notification/preference rows; explicit source FKs and type/schema checks | Viewer-scoped inbox; ordinary delivery respects preferences and aggregates routine events | Cross-user/source, bounded-payload, preference, digest, pagination, and deletion tests |
| SC-NOT-002 | Protected encrypted recipient intents bind audit event and transition generation | Separately granted security-delivery worker; essential notices ignore product preferences | Prior/replacement/current/incoming recipient, decryption-grant, retention, redaction, and transition-race tests |
| SC-ASY-001 | Fixed outbox/job types, bounded payloads, idempotency/state | Enqueue services and typed workers | Unknown type/schema and sensitive-payload rejection |
| SC-ASY-002 | Subject generation and expected-state writes | Execution-time authorization/cancellation | Disabled/deleted/withdrawn/superseded stale-job tests |
| SC-ASY-003 | Lifecycle generations and deletion/withdrawal events | Cleanup, projection, restore/replay workers | Extraction/artifact/index/export non-resurrection tests |
| SC-ASY-004 | Protected purpose-specific delivery records | Security notification worker | Prior/replacement/current/incoming recipient race tests |
| SC-ASY-005 | Pending/delivered/failed/cancelled/dead-letter states | Owner/ops retry and escalation surfaces | False-success, retry-intent, and escalation tests |
| SC-DEL-001 | Restrictive history and explicit ownership classes | Deletion classifier | Public-history preservation and private-data removal tests |
| SC-DEL-002 | Locked deletion aggregate and transactional revocation | Deletion service plus cleanup/outbox | Unrelated-user preservation and partial-failure tests |
| SC-DEL-003 | Nullable account link with distinct contributor subject | Anonymization/projection services | Re-registration and duplicate-position tests |
| SC-DEL-004 | Exactly-one explicit hold-target FK and fixed bounded state | Hold/release service with owner authorization | Invalid target, overbroad retention, concurrent deletion/hold, and expiry-resume tests |
| SC-DEL-005 | Backup retention metadata and event replay | Restore applies later privacy events first | Backup-expiry disclosure and no-resurrection rehearsal |
| SC-ROU-001 | Public projections only | Public GET and stateless calculate routes | Private-count/cache and no-order-row tests |
| SC-ROU-002 | Ownership, revision, idempotency state | Auth/status/CSRF/private-cache middleware | Cross-user and stale-session route tests |
| SC-ROU-003 | Contributor subject/assurance and self-count constraints | Contribution guard, rate limits, attribution preview | Unverified/new/disabled/self-amplification tests |
| SC-ROU-004 | Owner assignment/support/hold/audit and domain state relationships | Bounded exact owner search plus per-action account/exception allowlists and domain services; private context requires its case | Search-enumeration, case scope, route/action inventory, feature/disabled-action, routine-review independence, and strongest-gate tests |

## UX, operations, deferrals, and gates

| Requirement | DB / schema control | Service, route, worker, authorization | Verification / operations |
|---|---|---|---|
| SC-UX-001 | Message keys and structured validation support accessible rendering | Semantic controls and announcements | Keyboard, screen-reader, focus, contrast, zoom/reflow tests |
| SC-UX-002 | Revision/idempotency/checksum/stale-version fields | Small paginated payloads and retry/resume states | Interrupted LTE, duplicate tap, app suspension, stale resume tests |
| SC-UX-003 | Search keys, aliases, history, visibility filtering | Deterministic disambiguating search | Ambiguous names, alias labels, private-count tests |
| SC-UX-004 | Separate content/applicability/warning state | Precise labels and non-endorsement output | Copy/metadata/output language acceptance tests |
| SC-OPS-001 | Exact migration definitions, checksums, locks, timeouts, grants | Repository-owned migration runner | Disposable migration and definition-fingerprint tests |
| SC-OPS-002 | Backup/recovery metadata | Backup/restore/rehearsal procedure | Fresh backup, apply, verify, safe rollback, fingerprint record |
| SC-OPS-003 | Additive schema/capability state | Server feature gates and backward-compatible releases | Mixed-version, disabled-route, and non-destructive rollback tests |
| SC-OPS-004 | No generic SQL action | Exact allowlisted Ops/manual procedure | Command/input allowlist and checksum verification |
| SC-OPS-005 | Operational state/metrics tables where required | Monitoring, reconciliation, escalation, restore workers | Fault injection and private-payload redaction tests |
| SC-DEF-001 | No partial tables/semantics presented as supported | Capability boundary returns unsupported | Deferred-feature, including fee, negative tests |
| SC-DEF-002 | No premature broad roles/extensions/import tables | Feature remains absent/gated | Architecture and route/schema inventory review |
| SC-GAT-001 | Supported sealed fixture and no persistence dependency | Anonymous calculator only | Full calculator acceptance suite |
| SC-GAT-002 | Order/account/security/deletion schema complete | Saved-order routes enabled only after capability check | Persistence, privacy, backup, and sealing suite |
| SC-GAT-003 | Contributor/proposal/review/evidence identity complete | Contribution routes assurance-gated | Community security/privacy/trust suite |
| SC-GAT-004 | Upload/artifact/job/recovery schema complete | Quarantine, artifact, withdrawal workers | File-security, restore, and lifecycle suite |
| SC-GAT-005 | Owner/support/token/audit/hold schema complete | Strong owner guard, notifications, break-glass | High-impact auth/audit/recovery suite |
| SC-GAT-006 | Profile/compatibility/dependency schema complete | Profile resolver and composition enabled explicitly | Profile ambiguity, visibility, withdrawal, and hash suite |

## Matrix completeness rule

CI or a review script for every implementation PR that changes this contract
must compare requirement IDs in both files. A missing, duplicated, or unknown
matrix ID fails the documentation gate.
