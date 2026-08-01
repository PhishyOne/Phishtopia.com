# StoreCalc Schema Triple-Check

Issues: #111, #109

Status: mandatory corrections and launch boundaries found during the third independent design review.

This review supplements the schema design, integrity addendum, hostile review, and final clarifications. Executable migrations must not begin until one consolidated implementation contract incorporates every accepted correction.

The third pass focused on product behavior that can be lost when concentrating only on relational integrity: shared catalogs, anonymous use, personal funds, owner recovery, effective dates, privacy leakage, international text, evidence independence, and bounded public workloads.

## 1. Programs and catalogs may apply to many facilities

The current conceptual model places each `store_program` directly under one facility. That creates a duplication trap.

A state, federal agency, private vendor, county system, or regional authority may publish one commissary program or catalog used by many facilities. Copying the same template into every facility would:

- fragment reviews and correction reports;
- duplicate evidence and uploads;
- create conflicting copies of the same price sheet;
- make a statewide update require hundreds of proposals;
- misrepresent a system-level source as facility-specific;
- make confidence counts appear independent when they are copies.

The normalized model should instead separate program identity from facility applicability.

One acceptable shape is:

```text
store_programs
  id
  owning_agency_id nullable
  owner_user_id nullable for private programs
  scope_type
  name
  status

program_facility_assignments
  id
  store_program_id
  facility_id
  valid_from date nullable
  valid_through date nullable
  discovered_at timestamptz
  retired_at timestamptz nullable
  source_evidence_id nullable
  assignment_state
```

Requirements:

- a program may be assigned to one facility, selected facilities, or an agency-wide set through explicit assignments;
- facility pages resolve applicable programs through assignments rather than ownership by the facility;
- assignment intervals for one program/facility pair must not overlap;
- completed orders snapshot the assignment or applicability context used;
- sealed versions, completed orders, and historical reviews are never bulk-reparented when assignments change;
- facility-specific differences use an explicit facility-specific program/template fork with provenance, not a hidden override layer;
- the first release may avoid automatic inheritance, but the schema must not require catalog duplication.

The architectural spine becomes:

```text
Facility <-> Program applicability -> Template -> Immutable version -> Sealed order
```

The user experience may still call these "facility templates." The database should not pretend every template originated at exactly one physical facility.

## 2. StoreCalc calculation must not require an account

The public calculator should remain usable without registration.

Rules:

- browsing public facilities, viewing public template status, and calculating an order do not require login;
- anonymous calculator state is ephemeral or local to the browser and is not inserted into `storecalc.orders`;
- authenticated persistence is required for server-saved drafts, completed orders, follows, private facilities, private templates, uploads, proposals, reviews, and notifications;
- a user may sign in and explicitly import the current anonymous draft, with a fresh server recalculation;
- anonymous state is never treated as trusted merely because it was produced by client JavaScript;
- order contents and personal available-funds values must not appear in URLs, referrers, analytics events, or ordinary request logs;
- anonymous endpoints remain rate-limited and accept bounded item/quantity payloads.

The persisted `orders.user_id NOT NULL` relationship is appropriate for saved orders. It must not become an accidental login requirement for the calculator itself.

## 3. Personal available funds are separate from facility limits

A facility may allow a $100 order while the user has only $63.42 available. StoreCalc must calculate both constraints.

Add an optional private order-level concept equivalent to:

```text
available_funds_minor nullable
available_funds_source text
```

Requirements:

- `NULL` means the user did not provide an available balance; it never means unlimited;
- the available-funds currency must match the order/template currency in the first release;
- StoreCalc performs no exchange-rate conversion in the first release;
- remaining personal funds are derived from `available_funds_minor - final_total_minor` using exact arithmetic;
- a negative result is an explicit over-budget amount;
- personal available funds are private, excluded from community evidence, third-party analytics, public shares by default, and ordinary logs;
- facility bucket limits and personal available funds remain separate in calculations and display.

This restores a fundamental calculator behavior without confusing a private balance with an institutional rule.

## 4. Persist validation outcomes explicitly

A mathematically reproducible order also needs a reproducible validity result.

The calculation engine should return structured outcomes such as:

```text
order_validation_results
  order_id
  validation_code
  severity
  scope_type
  version_item_id nullable
  spending_bucket_id nullable
  observed_value
  allowed_value nullable
  message_key
  engine_version
```

Initial severity semantics should distinguish:

- hard_error: impossible or prohibited under known rules;
- over_limit: known facility or personal limit exceeded;
- warning: incomplete or uncertain template information;
- informational: non-blocking explanation.

Rules:

- drafts may be saved with violations;
- finalization records the exact violations and warnings present at that time;
- the interface must not label an order compliant when required rules are unknown;
- product language should distinguish a finalized calculation from an order accepted by a correctional facility;
- warnings and violations participate in the completed-order snapshot/hash;
- future policy may decide which violations prevent a "ready" status, without changing historical results.

## 5. Distinguish the site owner from general administrators

The current `role = admin` gate is too broad as the permanent authorization model for owner-assisted account recovery.

A future moderator or StoreCalc administrator should not automatically gain the ability to change user emails, issue recovery tokens, alter roles, or transfer site ownership.

Use a minimal explicit owner capability rather than a full generalized RBAC system. One acceptable design is a singleton owner assignment:

```text
site_owner_assignment
  singleton_key boolean primary key check (singleton_key)
  owner_user_id integer unique references public.users(id)
  assigned_at timestamptz
  assignment_event_id
```

Requirements:

- account recovery, user email correction, role changes, and ownership transfer require the current owner capability;
- StoreCalc moderation actions may later be delegated separately without account-recovery authority;
- owner authorization is loaded from PostgreSQL on every sensitive request;
- the owner account cannot be disabled, demoted, or deleted until ownership is transactionally transferred;
- transfer requires recent reauthentication, explicit confirmation, audit history, session invalidation where appropriate, and notification;
- ordinary `admin` middleware may control navigation but is not sufficient authorization for owner actions.

## 6. Define bounded break-glass owner recovery

The dashboard cannot recover the owner account when the owner cannot sign in to the dashboard.

Before owner-management features launch, define one bounded recovery procedure outside normal web routes. It must:

- operate only from a trusted production administration context;
- use a repository-owned, checksum-verified command or exact migration/action rather than arbitrary SQL;
- identify one target account and one allowed recovery operation;
- require explicit confirmation and a reason;
- create an audit record or signed recovery artifact;
- invalidate existing sessions and recovery tokens;
- never display password hashes or set a permanent password chosen by the operator;
- avoid becoming a general account-editing back door.

This is emergency recovery, not routine support. Routine user recovery stays in the owner dashboard.

## 7. Account disabling must affect every access path

Adding `account_status` is insufficient unless authentication and session behavior enforce it consistently.

Required behavior:

- login rejects disabled accounts without revealing unnecessary status details;
- disablement invalidates all existing sessions transactionally;
- authenticated request guards verify current account status where required rather than trusting an old session forever;
- password-reset, verification, email-change, recovery, and federated-login flows all check status;
- reactivation does not silently restore old sessions or tokens;
- account deletion and owner transfer protect the last usable owner;
- state changes create audit and durable notification events.

## 8. Add facility timezone and effective-date semantics

A `date` on a store sheet is interpreted in the facility or program's local context, while publication activity is recorded as an absolute timestamp.

The directory should support an IANA timezone identifier where a physical facility has a meaningful local timezone.

Requirements:

- facility timezone values come from a reviewed allowlist, not arbitrary offsets;
- source effective dates remain calendar dates and are not converted as UTC midnights;
- publication `started_at`/`ended_at` values remain `timestamptz` system-history facts;
- discovering a sheet late does not backdate the publication interval;
- the source effective date may predate the system publication date and both remain visible;
- default "current template" selection uses current publication state, not a retroactive rewrite based solely on source effective date;
- scheduled future publication, if later supported, uses an explicit state/job and cannot make a future version appear current early.

This preserves both valid-time and system-time meaning without claiming perfect historical knowledge.

## 9. Do not count duplicated evidence as independent corroboration

The confidence system must distinguish independent evidence from repeated copies of one document.

Evidence records need normalized fingerprints and grouping concepts sufficient to identify:

- exact duplicate bytes;
- a sanitized derivative of the same raw upload;
- the same official source mirrored at several URLs;
- repeated uploads of the same store sheet;
- materially independent newer evidence.

Requirements:

- identical or derivative documents may improve availability but do not count as independent corroboration;
- confidence explanations state how many independent evidence groups support a fact;
- uploader count is not equivalent to independent source count;
- coordinated or newly created accounts receive limited automated weight;
- source fingerprints and grouping decisions are reviewable and reversible through events;
- raw hashes or metadata that could expose private uploads are not published unnecessarily.

## 10. Bound public and community workloads

The schema and services must assume spam, accidental loops, and hostile bulk submissions.

Before launch, define limits for:

- uploaded file count, size, pages, image dimensions, decompression, and storage per user;
- extraction payload size and item count;
- facility requests and support votes per account/time window;
- proposals, reviews, correction reports, comments, and evidence links;
- maximum items, categories, buckets, rules, and warnings per template version;
- maximum quantity and monetary magnitude per order;
- notification and outbox retry growth;
- search page size and pagination depth.

Every list endpoint uses deterministic pagination. No public route loads an unbounded facility directory, catalog, review history, or notification set.

Quotas are product and abuse controls, not confidence signals.

## 11. Define international text and code normalization

`LOWER(text)` alone is not a complete international input policy.

At application boundaries:

- normalize supported identifiers and search keys consistently, using a documented Unicode normalization form;
- preserve original/native display text separately from normalized search text;
- reject or sanitize control characters and unsafe bidirectional formatting in identifiers and short labels;
- enforce bounded code-point and byte lengths;
- use reviewed ISO country/currency codes and BCP 47 language tags where applicable;
- do not use normalized display names as stable identity keys;
- treat homoglyph similarity as a duplicate-review hint, not automatic proof;
- escape all user-supplied text on output and sanitize any intentionally supported rich text through a strict allowlist.

Search normalization versions should be rebuildable so improving search does not alter canonical identities.

## 12. Protect private context from caches, logs, and referrers

Database authorization is not enough if private context leaks through surrounding infrastructure.

Requirements:

- private StoreCalc pages use appropriate cache-control headers and are not placed in shared public caches;
- user-specific facility selections, private template IDs, order IDs, available funds, and recovery case IDs do not enter third-party analytics;
- sensitive mutations use POST or another non-URL request body and never query-string secrets;
- application logs redact tokens, emails where unnecessary, order contents, available funds, private storage keys, and uploaded document names;
- error reports contain stable correlation IDs rather than dumping request/session bodies;
- public facility/template pages and private user selections remain distinct concepts;
- notification emails avoid exposing sensitive facility/order details in subject lines or lock-screen previews by default.

## 13. Clarify private provisional facility approval

Approval of a public facility request must not silently publish the user's private programs, templates, orders, or uploads.

When a private provisional facility is matched to a canonical facility:

- the private facility becomes a private merged/tombstoned identity or records a canonical match;
- current settings and explicitly selected private drafts may be redirected after confirmation;
- completed private orders retain original provenance;
- private templates remain private unless separately proposed for publication;
- uploads remain private unless separately approved as public evidence;
- the user receives a clear preview of what will move, remain private, or require a new proposal;
- no account association or current-facility selection becomes publicly visible.

## 14. Use stable pseudonymous contributor subjects for retained history

Public review and proposal history may need to survive account deletion without retaining an active user account or personal data.

Use a separate contributor-subject identity or another reviewed pseudonymous mechanism so append-only event history can distinguish positions that belonged to different historical contributors after `public.users` links are removed.

Requirements:

- the subject identifier is not a login credential and cannot be used to recover the former email/username;
- deleting an account removes private profile data and direct account links according to policy;
- retained public events preserve only the minimum subject continuity needed for audit and duplicate-position handling;
- confidence projections do not collapse all deleted contributors into one anonymous actor;
- re-registration does not automatically inherit old trust or create a guaranteed way to cast a second weighted review on the same proposal;
- retention duration and user-facing deletion disclosure are defined before public reviews launch.

## 15. Make the consolidated contract the only implementation source

The current PR intentionally contains conceptual documents plus corrections. That is safe while reviewing, but dangerous once SQL work begins.

Before executable migrations:

1. produce one consolidated schema contract;
2. mark earlier conceptual documents as superseded or historical review records;
3. include final tables, columns, keys, checks, triggers, ownership, grants, state transitions, and deletion behavior;
4. include a traceability matrix mapping every mandatory review correction to a schema object or service test;
5. include an explicit list of deferred features so absence is not mistaken for an implementation oversight;
6. derive executable migration tests from the consolidated contract rather than prose scattered across addenda.

## Third-pass result

The design remains viable, but the corrected core model is now:

```text
Public or private facility
  <-> effective program assignment
      -> template
          -> immutable version
              -> anonymous calculation or authenticated saved order
                  -> optional personal available funds
                  -> parallel facility limit results
                  -> sealed validation snapshot
```

Community accuracy remains:

```text
Evidence groups + immutable proposals + append-only contributor positions
  -> explainable confidence
  -> reviewable publication decision
```

No production database, runtime route, or executable migration is changed by this document.