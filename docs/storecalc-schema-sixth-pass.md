# StoreCalc Schema Sixth-Pass Review

Issues: #111, #109

Status: mandatory authorization, history, privacy, and dependency corrections found during the sixth independent design review.

This pass examines the platform as an integrated web application rather than only a schema and calculator. It focuses on mutation security, directory history, composed-configuration visibility, contribution privacy, dependency withdrawal, and sensitive derived data.

## 1. Protect every state-changing route, not only owner actions

Earlier reviews explicitly require CSRF protection for sensitive owner actions. The same class of protection is required for ordinary authenticated StoreCalc mutations.

Protected operations include:

- save, complete, archive, clone, or delete an order;
- select a current facility/program;
- follow or unfollow a facility;
- create or modify a private facility/template;
- submit a facility request or support an existing request;
- upload or delete a document;
- submit, revise, retract, or resolve a proposal;
- add or change a review position;
- create a correction or abuse report;
- change notification/privacy settings;
- publish, withdraw, or alter applicability when authorized.

Requirements:

- use CSRF tokens or an equivalently reviewed origin-bound mechanism appropriate to the application;
- validate `Origin`/`Referer` where useful as defense in depth;
- reject unexpected content types and method overrides;
- do not use GET for state changes;
- SameSite cookies are defense in depth, not the sole control;
- idempotency prevents duplicate application but does not replace CSRF protection;
- authorization, ownership, current account status, and state transition checks still run after CSRF validation;
- upload endpoints receive the same protection and bounded validation.

Anonymous calculation endpoints do not mutate server-side user state but remain bounded and rate-limited.

## 2. Preserve canonical directory history as product data

A mutable `facilities` row plus `updated_at` is insufficient for a source-backed directory.

Names, status, governing agency, physical location, facility type, and other public facts may change. The system must explain what changed, when StoreCalc learned it, what effective date was claimed, and what evidence supported the change.

Use append-only directory change events, attribute versions, or an equivalent temporal model. One possible shape includes:

```text
facility_fact_versions
  id
  facility_id
  fact_type or bounded attribute set
  value payload with strict schema
  valid_from date nullable
  valid_through date nullable
  recorded_at timestamptz
  evidence_id nullable
  proposal_id nullable
  supersedes_version_id nullable
  state
```

Requirements:

- current directory fields may exist as rebuildable projections for fast reads;
- accepted changes do not erase prior names, agency relationships, locations, or statuses;
- renamed and closed facilities remain searchable through aliases/history;
- system-time and claimed effective date remain separate;
- a failed official-source fetch never becomes a closure event;
- facility merges remain separate identity-reconciliation events;
- completed orders keep original snapshots and IDs regardless of later directory corrections;
- agency and jurisdiction changes that affect interpretation receive equivalent source-backed history where needed.

Administrative audit logs do not replace public factual history. Audit answers who performed an action; directory history answers what StoreCalc believed and why.

## 3. Extend contribution privacy to every facility-specific action

The privacy-preserving contributor-subject model applies not only to reviews and proposals but also to:

- facility requests;
- facility-request support;
- uploads and public evidence attribution;
- applicability proposals and reports;
- directory corrections;
- comments;
- translated confirmations;
- source-maintenance contributions.

Requirements:

- public facility-request pages do not expose the requester's normal account identity by default;
- supporter identities remain private; only bounded aggregate demand may be shown;
- evidence pages do not automatically expose the uploader's username or profile;
- public attribution settings are consistent across contribution types;
- internal anti-abuse and duplicate controls continue to use stable contributor subjects;
- public contribution history never becomes an indirect public list of the user's facility relationships;
- small-count aggregates use thresholds or generic wording where identification is plausible.

A user can voluntarily disclose context in text, but the product should warn against unnecessary personal details and must not add disclosure automatically.

## 4. Visibility of a composed configuration is the intersection of its components

A resolved configuration may combine a base template, scoped profile, applicability record, and evidence relationships with different visibility and ownership.

Rules:

- a configuration is publicly browseable only when every authoritative component required to reproduce it is public and publication-eligible;
- combining a public base with a private profile produces a private configuration;
- combining a private base with a public profile remains private;
- private components are never revealed through conflict errors, counts, hashes, cache keys, or public existence checks;
- server authorization is evaluated for every component, not only the top-level resolved-configuration ID;
- copying or publishing a private component follows an explicit workflow and never changes its visibility by reference alone.

Configuration caches are keyed by component IDs/hashes, engine version, and visibility scope. A private resolved configuration must never enter a shared public cache.

## 5. Display confidence without averaging away a critical weak component

A resolved order configuration may depend on:

- catalog content confidence;
- facility applicability confidence;
- scoped tax/limit profile confidence;
- evidence publication status;
- unresolved warnings.

Do not collapse these into a simple average that makes a serious weak link disappear.

Requirements:

- public pages show material component states separately;
- a disputed or unsupported critical component prevents an unqualified `community-confirmed` result for the effective configuration;
- an overall summary may use a documented conservative rule, such as the weakest critical component, but must remain explainable;
- optional informational components do not incorrectly downgrade unrelated facts;
- confidence projections are rebuildable from component events and assessments;
- no score changes content, applicability, or publication automatically without an explicit bounded transition.

## 6. Model dependency withdrawal and supersession explicitly

Composed configurations introduce dependencies.

If a base version, scoped profile, applicability record, or public evidence artifact is withdrawn, the system must determine which configurations can still be used.

Requirements:

- dependencies are queryable and acyclic;
- withdrawal blocks new resolution when a required component is unsafe or unavailable;
- dependent configurations receive derived unavailable/warning state without mutating their sealed content;
- completed orders remain viewable through safe snapshots;
- replacement components create new resolved hashes rather than rewriting old ones;
- emergency actions identify all affected active configurations and public pages;
- restoration or reversal uses a new audited event, not deletion of the withdrawal history;
- cache invalidation follows dependency impact.

## 7. Treat scoped trust and demand data as sensitive derived data

Contributor trust projections, facility-scoped review histories, request support, and demand analytics can reveal sensitive associations even when orders and current-facility settings remain private.

Requirements:

- scoped trust tables are internal and grant no public profile badge tied to a named facility by default;
- ordinary user-management pages do not expose facility-scoped trust or demand history;
- analytics retain only the granularity required for product decisions;
- no third-party analytics receive facility/template identifiers or contributor subjects;
- internal demand events are deduplicated, bounded, access-controlled, and retained for a defined period;
- account deletion and contributor-subject retention policies cover derived projections and source events explicitly;
- rebuilding a projection after deletion must not recreate data that policy required to be removed.

## 8. Avoid information leaks through authorization errors

Private IDs and relationships must not be enumerable through response differences.

Requirements:

- unauthorized private resources generally return the same outward result as nonexistent resources where appropriate;
- validation errors do not reveal another user's facility, template, profile, upload, evidence, proposal, or order title;
- bulk endpoints filter unauthorized rows before counts and pagination metadata are computed;
- conflict responses expose only records the viewer may access;
- timing and cache behavior should not make private existence trivially distinguishable;
- owner/abuse workflows may access bounded private context only after authorization and record the reason where required.

## 9. Define monitoring for durable and safety-critical workflows

The design already requires outbox delivery, extraction jobs, object cleanup, imports, and confidence projections. These processes need bounded operational observability.

Before launch, define monitoring and owner-visible failure states for:

- outbox backlog, repeated failures, and dead letters;
- quarantined uploads stuck in processing;
- missing or mismatched evidence objects;
- failed directory imports and source checks;
- projection rebuild failures;
- calculation/hash mismatches;
- emergency withdrawal propagation and cache invalidation;
- migration/version capability mismatches.

Logs and alerts use correlation IDs and bounded metadata. They never dump private order contents, personal available funds, raw uploads, tokens, or unrestricted payloads.

Monitoring must distinguish user-visible temporary failure from permanent dead-letter/manual-review states.

## 10. Required sixth-pass tests

Before implementation acceptance, tests must prove:

- a cross-site request cannot save an order, cast a review, upload evidence, follow a facility, or submit a request using the user's session;
- prior facility facts remain available after a rename, closure, agency change, or correction;
- public facility requests and evidence pages do not expose normal account identities by default;
- a public base plus private profile cannot be fetched or cached as a public configuration;
- a disputed critical applicability/profile component cannot be hidden by averaging confidence scores;
- withdrawing a required component blocks new resolution while preserving completed orders;
- private resource counts and errors do not reveal another user's records;
- deleting/anonymizing a contributor updates derived trust/demand projections according to policy;
- a dead-lettered notification or missing evidence object becomes visible operationally without leaking private payloads.

## Sixth-pass result

The platform's trust boundary is broader than database row ownership:

```text
Request integrity
  + component authorization
  + privacy-preserving attribution
  + temporal directory history
  + dependency-aware withdrawal
  + operational observability
```

All are required to keep the community review system trustworthy and the private user experience genuinely private.

No production database, runtime route, or executable migration is changed by this review.