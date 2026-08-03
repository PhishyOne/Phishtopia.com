# StoreCalc Tenth-Pass Security and Temporal Review

> Historical review record. Its accepted corrections are consolidated in
> `storecalc-implementation-contract.md`; this file is not an implementation
> source.

Issues: #111, #109

Status: mandatory corrections found after the ninth-pass audit reported no new material conceptual flaw.

This pass deliberately challenges controls that earlier documents named but did not specify tightly enough to implement safely. It focuses on idempotency, account-credential races, calculation context time, encryption and key management, untrusted content delivery, privileged-audit durability, and deletion holds.

## 1. Define idempotency as a security and consistency contract

Earlier reviews correctly require idempotency for unreliable mobile connections and retried sensitive actions, but an unscoped idempotency key can itself create cross-user data exposure or incorrect replay.

Every idempotent mutation record must bind at least:

```text
principal or bounded anonymous session
operation type and route contract version
target aggregate or creation scope
request payload hash
expected aggregate revision where applicable
result status and bounded response reference
created_at and expires_at
```

Requirements:

- a key is unique only within its authenticated principal/session and operation scope;
- replaying the same key with the same canonical payload returns the original committed result or safe result reference;
- replaying the same key with a different payload, target, or expected revision is rejected as a conflict;
- a key used by one account cannot reveal or replay another account's result;
- idempotency storage never contains raw tokens, private document bytes, passwords, or unrestricted request bodies;
- completion, review submission, facility requests, uploads, owner recovery, publication switches, and outbox-triggering actions define explicit retention periods;
- idempotency and optimistic concurrency are both enforced: one prevents duplicate application, while the other prevents stale overwrites;
- failed attempts are classified carefully so a transient pre-commit failure can retry while a committed result cannot apply twice;
- rate limiting remains independent and cannot be bypassed by generating unlimited keys.

## 2. Make credential and account-state transitions race-safe

Owner-assisted recovery, ordinary email change, password reset, account disablement, role change, strong-factor enrollment, federated login, and session refresh may race with one another.

Sensitive account transitions must lock or otherwise serialize the target account's credential state and update a monotonically increasing security generation/version.

Required behavior:

- completing an owner-assisted email correction invalidates prior pending-email links, password-reset links, recovery tokens, verification tokens, and affected sessions according to policy;
- an older pending email-change link cannot complete after the owner has corrected the account to another address;
- password, role, owner assignment, account status, or strong-factor changes rotate/regenerate the active session identifier rather than preserving a fixation-prone session;
- session records carry or check the current security generation for high-risk access paths;
- disabled/reactivated accounts do not regain previously issued sessions or tokens;
- ownership transfer invalidates stale owner assertions and requires new strong authentication under the new owner;
- concurrent recovery attempts produce one authoritative outcome and complete audit history rather than last-write-wins credential state;
- security notices are emitted through the durable outbox from the same committed transition.

The database-backed owner check remains mandatory; session-cached claims are only navigation hints.

## 3. Define the calculation context date explicitly

The resolver already depends on facility, audience, and time, but `time` must not be an implicit mixture of browser clock, order creation time, template effective date, and publication time.

A calculation should carry explicit context equivalent to:

```text
calculation_context_date
facility_timezone
calculated_at
intended_order_date_source
```

Requirements:

- the default context date comes from the server using the facility's reviewed IANA timezone, not the client clock;
- the user may explicitly select a future or historical intended order date when the product supports that workflow;
- the resolver chooses applicability and configuration for the explicit context date while separately recording current system publication state;
- preparing an order before a future catalog becomes effective must not silently use that future catalog early;
- resuming a draft after the context date or active applicability changes requires an explicit recalculation/comparison;
- a completed order snapshots both its intended context date and actual completion timestamp;
- backdated calculations are labeled historical and do not imply the facility would accept a newly created order;
- order-cycle deadlines, prior-purchase ledgers, and recurring period consumption remain explicitly deferred until modeled rather than inferred from this date.

## 4. Add an encryption, transport, and key-management contract

Database authorization and privacy policy are insufficient unless data and credentials are protected in transit, at rest, in backups, and during key rotation.

Before private uploads, saved orders, owner recovery, or strong authentication launch, define:

- TLS requirements for browser, database, object storage, email-provider, and internal worker connections;
- encryption-at-rest guarantees for PostgreSQL volumes, object storage, backups, and temporary processing storage;
- least-privilege identities for the web app, workers, migration runner, backup process, and restore process;
- a secret inventory covering session secrets, email/reset signing material, object credentials, strong-authentication configuration, and any application encryption keys;
- managed secret storage rather than repository files, database rows, logs, or shell history;
- key/version identifiers where old sealed data or tokens must remain verifiable across rotation;
- rotation and emergency-revocation procedures tested without exposing private content or invalidating historical hashes accidentally;
- encrypted backup restore tests that prove required keys are recoverable through a separately protected process;
- no home-grown encryption when platform-managed encryption and strict access controls satisfy the threat model.

High-entropy one-time tokens continue to store only a hash or reviewed keyed digest. Raw values are displayed or transmitted once and never logged.

## 5. Isolate untrusted documents, links, and exports

Upload scanning and public-artifact separation are already required, but user-supplied content can also attack viewers through active documents, unsafe links, or generated exports.

Requirements:

- original uploads and public evidence artifacts are served from an isolated origin or forced attachment path with restrictive content type and `Content-Disposition` behavior;
- HTML, SVG, script-capable documents, embedded active content, and polyglot files are rejected, transformed, or sandboxed through a reviewed pipeline;
- the main application uses a restrictive Content Security Policy compatible with the chosen UI architecture;
- user-supplied source links permit only reviewed schemes, render safely, use appropriate opener/referrer protections, and never become executable markup;
- generated CSV or spreadsheet-compatible exports neutralize formula injection while preserving the visible value;
- PDFs and printable documents are generated from escaped structured data, not concatenated HTML or document fragments from uploads;
- filenames are sanitized for headers and display separately from storage keys;
- content-sniffing protections and download headers are tested across supported browsers;
- withdrawing an unsafe artifact invalidates public delivery caches without deleting historical evidence relationships.

## 6. Make high-impact audit history resistant to privileged tampering

An append-only trigger protects against ordinary application writes but does not protect history from a compromised database owner or emergency operator.

Before owner-assisted account recovery, ownership transfer, role changes, or break-glass recovery launch, add a bounded tamper-evidence strategy such as:

- canonical event hashes chained or batched in deterministic order;
- periodic signed digests written to a separately controlled/off-host destination;
- repository- or operations-owned recovery artifacts for break-glass actions;
- verification tooling that detects missing, reordered, or altered events;
- clear distinction between application audit events, public factual history, and infrastructure access logs.

This is tamper evidence, not a promise that the database can never be altered. Sensitive event payloads remain minimized and redacted before hashing or export.

## 7. Serialize deletion, moderation hold, and legal/privacy retention decisions

Account deletion, evidence withdrawal, abuse investigation, copyright/privacy takedown, backup retention, and public-history preservation can conflict.

The consolidated contract must define a narrow hold model rather than allowing deletion workers and moderation workflows to race.

Requirements:

- a hold has a fixed type, scope, actor/system authority, reason category, creation time, review/expiry time, and audit event;
- holds retain only data genuinely required for the bounded purpose and do not become indefinite convenience archives;
- user-facing deletion disclosures explain when minimum retained history or encrypted backups expire;
- private orders and funds are not retained merely because the account once contributed public data;
- unsafe public bytes can be withdrawn immediately even when minimum hashes/events remain under hold;
- deletion jobs lock/classify the affected account and cannot partially delete around a newly created hold;
- releasing or expiring a hold resumes the pending deletion/redaction workflow idempotently;
- owner support cannot create unrestricted secret notes as a substitute for a formal hold.

## 8. Required tenth-pass tests

Before the relevant services launch, tests must prove:

- an idempotency key cannot be replayed across users, operations, targets, revisions, or different payloads;
- a committed mobile retry returns the original result without duplicating the mutation;
- an old pending email-change or reset token cannot succeed after owner recovery changes credential state;
- role/status/owner/factor changes regenerate sessions and invalidate stale security generations;
- the facility-local context date, not the browser clock, selects the effective configuration;
- resuming a draft across an applicability/effective-date change requires explicit recalculation;
- private data remains encrypted in supported storage/backup paths and a tested rotation/restore procedure retains authorized access;
- unsafe active uploads and source-link schemes cannot execute in the application origin;
- spreadsheet exports cannot trigger formula execution from user-controlled labels;
- modifying or removing a high-impact audit event is detectable by the external digest/verification process;
- account deletion and a concurrent bounded hold produce one complete, auditable outcome rather than partial deletion.

## Tenth-pass result

The ninth pass correctly found no additional broad product domain, but several named controls were still under-specified enough to produce security or historical-integrity bugs during implementation.

The corrected implementation boundary now additionally requires:

```text
Scoped idempotency
  + serialized credential state
  + explicit calculation context date
  + encryption/key lifecycle
  + isolated untrusted content
  + tamper-evident high-impact audit
  + bounded retention holds
```

No executable migration, runtime route, authentication behavior, database, object storage, or production system is changed by this review.
