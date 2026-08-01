# StoreCalc Platform Architecture

Issue: #109

## Status

This document defines the intended StoreCalc product architecture before implementation begins. It replaces any assumption that the prior Bash script or Android APK is the functional specification. Those artifacts remain historical references only.

StoreCalc is planned as a phone-first, privacy-conscious platform for creating commissary orders from configurable facility templates whose public accuracy is maintained through evidence, immutable versions, structured community review, and bounded owner intervention.

## Architectural spine

The core relationship is:

```text
Facility
  -> Store program
    -> Template
      -> Immutable template version
        -> Order
```

These concepts must remain separate.

- A **facility** is a canonical physical or organizational location.
- A **store program** represents a distinct catalog or privilege context at that facility, such as general population, segregation, medical, holiday store, or another facility-defined program.
- A **template** is the enduring identity of one store program's catalog and rules.
- A **template version** is an immutable snapshot of catalog items, prices, taxes, spending buckets, quantity limits, eligibility rules, evidence, and effective dates.
- An **order** references exactly one template version and preserves the prices and rules used when the order was created.

A public correction never edits an existing template version. It creates a proposed replacement version. Historical versions remain available to the orders, reviews, evidence, and disputes that reference them.

## Product areas

StoreCalc consists of three connected workflows:

1. Use StoreCalc to find a facility, select a template, and build an order.
2. Contribute facility, catalog, rule, and evidence information.
3. Review proposed public template versions and report errors in active versions.

A fourth, separately protected area provides site-wide owner administration for account support and exceptional StoreCalc intervention.

## StoreCalc navigation

The StoreCalc feature should expose a small mobile-friendly navigation surface:

```text
StoreCalc
  Start Order
  Facilities
  Templates
  Contribute
  Review
  My StoreCalc
```

`Review` may be visually emphasized only when useful work is available to the signed-in user. Administrative routes must never depend on hidden navigation for authorization.

## Route framework

The exact route names may be adjusted during implementation, but route responsibilities should remain bounded.

### Public and order routes

```text
GET  /storecalc
GET  /storecalc/facilities
GET  /storecalc/facilities/:facilityId
GET  /storecalc/templates/:templateId
GET  /storecalc/templates/:templateId/versions/:versionId
GET  /storecalc/orders/new
GET  /storecalc/orders/:orderId
```

The public StoreCalc home should support facility search, country browsing, public template inspection, and an explanation of verification status. Private drafts and saved orders require authentication unless a later reviewed local-only draft mechanism is deliberately added.

### Facility request routes

```text
GET  /storecalc/facilities/request
POST /storecalc/facilities/request
GET  /storecalc/facility-requests/:requestId
POST /storecalc/facility-requests/:requestId/support
```

The request flow must search canonical names, aliases, renamed facilities, closed facilities, nearby facilities, and existing pending requests before accepting a new request.

A user may create an immediately usable private provisional facility while the public request is pending. Approval or merging must preserve attached templates, orders, evidence, comments, and history.

### Contribution routes

```text
GET  /storecalc/contribute
GET  /storecalc/contribute/upload
POST /storecalc/contribute/upload
GET  /storecalc/proposals/:proposalId/edit
GET  /storecalc/proposals/:proposalId/compare
POST /storecalc/proposals/:proposalId/submit
```

Document extraction must produce a private draft. No OCR, parser, language model, or import job may publish facility facts directly.

The contributor reviews and corrects extracted fields before submission. The comparison page must show additions, removals, price changes, category changes, quantity-limit changes, tax changes, spending-bucket changes, eligibility changes, and effective-date changes.

### Review routes

```text
GET  /storecalc/review
GET  /storecalc/review/:proposalId
POST /storecalc/review/:proposalId/accurate
POST /storecalc/review/:proposalId/needs-correction
POST /storecalc/versions/:versionId/report
```

Reviews and correction reports belong to a specific proposal or immutable template version.

The primary accuracy controls are:

- `Accurate`
- `Needs correction`

Generic likes, dislikes, stars, or popularity scores must not substitute for accuracy review.

`Needs correction` requires at least one structured reason and should support affected item, category, rule, proposed correct value, explanation, evidence date, and optional supporting document.

### Private user routes

```text
GET  /storecalc/me
GET  /storecalc/orders
GET  /storecalc/templates/mine
GET  /storecalc/contributions
GET  /storecalc/notifications
POST /storecalc/current-facility
POST /storecalc/follows
```

The user area should cover:

- current facility and current store program
- followed facilities
- draft and saved orders
- private templates
- published contributions
- submitted proposals and correction reports
- review history
- notifications
- language preferences
- privacy and analytics preferences

Current facility, followed facilities, transfer history, private templates, orders, and contribution drafts are private by default.

## Normal order workflow

```text
StoreCalc home
  -> select country
  -> search/select facility
  -> select store program/template
  -> inspect active version and confidence
  -> start order
  -> save draft or completed order
```

Before starting an order, the user should be able to inspect:

- template type and active version
- effective date and source date
- verification status
- known disputes or stale warnings
- overall limit and named spending buckets
- category and item tax treatment
- item quantity limits
- supporting evidence summary
- version history

The order builder should expose categories, search, quantity controls, rule warnings, and a persistent total summary.

Calculations should separately display:

- subtotal counting toward the main spending limit
- subtotal excluded from the main limit
- each named spending-bucket subtotal
- taxable subtotal where meaningful
- tax total
- final order total
- remaining amount for every limited bucket

Item behavior is explicit data. StoreCalc must never infer tax, eligibility, quantity, or spending-bucket treatment from an item's name.

All monetary values use integer minor units plus explicit currency metadata. JavaScript floating-point currency arithmetic is not acceptable.

## Saved-order history

A saved order must preserve or reference an immutable snapshot sufficient to reproduce its original result.

At minimum, it records:

- user
- facility
- store program
- exact template version
- currency
- selected item-version identities
- item display names used at order time
- unit prices used at order time
- quantities
- applicable rules and bucket assignments
- calculated subtotals, tax, and final total
- draft/completed status
- creation and update times

Changing the active template must not change an existing order.

## Facility directory

Use stable internal IDs. Names, aliases, translations, authorities, locations, and operational statuses may change without changing facility identity.

The directory hierarchy is:

```text
Country
  -> Jurisdiction
    -> Agency or system
      -> Physical region/state/territory
        -> Facility
          -> Store program
```

Every country should appear in the selector from the beginning. A country can have a support state such as:

- Full directory
- Limited directory
- Community starting
- Requested

Unsupported countries remain usable through private provisional facilities, private templates, uploads, and orders.

Facility records may include official name, native-language name, aliases, abbreviations, former names, facility type, governing authority, physical location, source metadata, and active/renamed/closed status.

Canonical public facility creation should be controlled and reviewable. Ordinary users request or propose canonical records rather than directly mutating the directory.

## Template and version lifecycle

Suggested lifecycle:

```text
Private draft
  -> Submitted
    -> Under review
      -> Needs revision
      -> Disputed
      -> Rejected
      -> Accepted
        -> Active version
          -> Stale or replaced
            -> Archived
```

Template-version public labels may include:

- Unverified
- Source-backed
- Community-confirmed
- Disputed
- Stale
- Archived

Workflow state and public confidence label are related but not identical. For example, an accepted active version can later become disputed without being deleted.

## Evidence model

Evidence should be independently addressable and reusable where appropriate.

Evidence metadata may include:

- source type
- source date
- upload date
- facility and store program
- original filename stored privately
- sanitized public filename where publication is allowed
- checksum
- uploader
- extraction status
- personal-information review status
- language
- confidence and conflict notes

Uploads must warn users not to submit names, inmate numbers, account numbers, balances, correspondence, or other personal documents. Evidence containing exposed personal information must remain private or be rejected until safely redacted.

## User-driven review

Community review is a core data-quality mechanism, not decorative engagement.

A correction report may identify:

- outdated price
- missing item
- item that should be removed
- incorrect name or description
- incorrect category
- incorrect tax treatment
- incorrect overall spending limit
- incorrect quantity limit
- incorrect spending-bucket treatment
- incorrect eligibility or privilege label
- incomplete or unreadable source
- wrong facility
- duplicate template
- another structured reason with explanation

Accuracy feedback and abuse reporting are separate systems. Spam, harassment, malicious uploads, coordinated manipulation, and exposed personal information require abuse/privacy reporting rather than an ordinary catalog correction.

## Confidence and trust

Evidence outranks popularity.

Confidence may consider:

- official or otherwise strong source quality
- source recency and effective date
- independent matching evidence
- detailed community confirmation
- unresolved conflicting evidence
- successful repeated use where meaningful
- prior contribution accuracy within a narrow scope
- suspicious account creation or coordinated activity

Trust should be scoped to a facility, store program, template, rule type, or contribution category. No ordinary contributor receives broad global authority merely from activity volume.

New or coordinated accounts should carry little automated weight. Automated scores should prioritize review and presentation; they must not silently erase conflicting evidence.

When evidence conflicts, preserve the competing proposals, show the conflict, mark the active version disputed when warranted, and select a provisional active version only through explicit bounded rules.

## Notifications

Notifications may cover:

- proposal comments
- detailed correction reports
- replacement proposals
- newer evidence
- dispute status changes
- accepted or rejected contributions
- facility-request status
- problems fixed by a newer version

Routine `Accurate` confirmations should be bundled rather than generating one notification per click.

Users may choose site notifications, email, both, or neither, subject to essential security and account-recovery notices.

## Privacy boundaries

StoreCalc must not require:

- inmate numbers
- housing units
- GPS location
- proof of incarceration
- legal documents unrelated to the facility template

Approximate connection country may be used only for bounded first-party demand analytics when disclosed and permitted. Raw IP addresses should not be retained in the product analytics event. Country mismatch is not proof of abuse and must never block facility selection.

Third-party advertising analytics must not receive facility names, current-facility settings, private templates, saved orders, comments, evidence, or correction-report contents.

## Owner dashboard

The owner dashboard is site-wide and separate from ordinary StoreCalc review.

Suggested route groups:

```text
/admin
/admin/users
/admin/users/:userId
/admin/recovery-cases
/admin/storecalc
/admin/storecalc/facility-requests
/admin/storecalc/disputes
/admin/storecalc/reports
/admin/audit
```

All owner routes require server-side role authorization. Sensitive actions require recent owner reauthentication.

### User management

The owner should be able to:

- search by username, email, or internal user ID
- view bounded account status and verification state
- view roles, registration time, last successful login, and active-session count
- correct approved fields such as username or email after independently confirming the support request
- restart email verification
- invalidate all sessions
- disable or reactivate an account
- initiate owner-assisted recovery
- review prior administrative actions

The owner dashboard must never display passwords, password hashes, cookies, session identifiers, verification-token values, recovery-token values, or secret provider credentials.

A normal permanent-password setter should not be provided. Owner-assisted recovery should issue a short-lived single-use recovery link or one-time code that forces the user to choose a new password and invalidates old sessions.

Email changes should notify the prior address and require verification of the replacement address where practical. The owner records a bounded support reason, but the application should not encourage unnecessary identity-document storage.

### Administrative workflow

Sensitive changes follow:

```text
Find user
  -> open or reference support/recovery case
  -> record reason
  -> preview exact changes
  -> recent owner reauthentication
  -> transactional change
  -> invalidate affected sessions/tokens
  -> send applicable security notices
  -> append audit event
```

### StoreCalc exception handling

The owner handles exceptions such as:

- approving or merging facility requests
- correcting canonical facility identity
- severe unresolved template manipulation
- malicious uploads
- exposed personal information
- legal or ownership disputes
- import failures
- security and abuse reports

Routine public-template corrections should not depend on owner approval.

### Impersonation boundary

Do not initially add silent `log in as user` capability.

A future support-session feature would require a separate security review, visible support-mode banner, explicit reason, recent owner authentication, short expiration, restricted actions, and complete auditing.

## Audit model

Administrative and high-impact moderation actions require append-only audit events.

Audit events should include:

- actor
- target entity and bounded identifier
- action type
- timestamp
- reason or case identifier
- sanitized old state
- sanitized new state
- success/failure
- reversal relationship where applicable

Passwords, hashes, tokens, cookies, raw evidence contents, private order contents, and unrestricted request bodies are excluded.

## Initial data domains

The normalized schema should distinguish at least:

- users, roles, role assignments
- owner reauthentication/recovery cases
- administrative audit events
- countries, jurisdictions, agencies, facilities, aliases
- facility requests, request supporters, follows
- store programs, templates, template versions
- categories, items, item versions, prices
- taxes, eligibility rules, quantity limits, spending buckets
- orders and order items
- uploads, evidence, extraction drafts
- proposals, proposal diffs, reviews, correction reports, comments
- notifications
- abuse, privacy, and security reports

Implementation should avoid a single generic JSON document as the authoritative data store. JSON may be useful for immutable snapshots, bounded rule payloads, diffs, or audit metadata, but important relationships and invariants require database constraints and foreign keys.

## Delivery boundaries

The platform must be delivered as reviewed slices.

1. Product and architecture specification.
2. Schema and migration design without production application.
3. StoreCalc page shell and facility-selection workflow.
4. Pure calculation engine with structured rules and exhaustive tests.
5. Local/draft order workflow, followed by authenticated persistence.
6. Facility directory and provisional facility workflow.
7. Private/public templates and immutable versioning.
8. Uploads, extraction drafts, evidence, and proposal comparison.
9. Community review, correction reports, disputes, and confidence.
10. Notifications and owner exception tools.
11. Official-source maintenance and demand-driven international growth.

Each slice requires a dedicated branch, focused tests, CI, a reviewable pull request, and production verification after merge. Database-affecting work additionally requires a versioned migration, disposable rehearsal, verified backup, post-migration checks, and rollback planning.

## Non-goals for the first implementation slices

- importing the old APK as the product model
- populating every facility worldwide before release
- unrestricted user edits to canonical facility records
- automatic publication from uploaded documents
- arbitrary owner SQL
- public PostgreSQL access
- global contributor superusers
- social popularity scoring as factual verification
- collecting inmate identifiers
- silent owner impersonation
- building the entire roadmap in one pull request
