# StoreCalc Eleventh-Pass Asynchronous Lifecycle Review

> Historical review record. Its accepted corrections are consolidated in
> `storecalc-implementation-contract.md`; this file is not an implementation
> source.

Issues: #111, #109

Status: mandatory asynchronous authorization and data-lifecycle corrections found after the tenth-pass review.

This pass examines work that is committed now but executed later: uploads, extraction, exports, notifications, evidence transformation, cache invalidation, projection rebuilds, source checks, and other queued jobs. A valid enqueue decision does not guarantee that the action remains valid when a worker eventually runs.

## 1. Every queued job needs execution-time state validation

A job may be delayed while:

- the account is disabled or deleted;
- an upload is withdrawn or placed on hold;
- evidence publication permission is revoked;
- a template/applicability component is withdrawn;
- an order share or export request is revoked;
- a support case is closed;
- a facility/template becomes private or merged;
- a newer job supersedes the old request.

Requirements:

- each job has a fixed allowlisted type, immutable job ID, correlation ID, subject/aggregate ID, enqueue-state version, and idempotency key;
- before performing a side effect, the worker reloads the current authoritative state and verifies the action is still permitted;
- stale jobs terminate as cancelled/superseded rather than publishing, emailing, exporting, or recreating deleted data;
- authorization-sensitive jobs verify the current owner/scope relationship or use a narrowly defined system authority appropriate to that job type;
- workers never treat possession of a queued database row as sufficient authorization;
- retries repeat the same validation and cannot bypass a later withdrawal or deletion;
- cancellation and supersession are durable states, not best-effort in-memory signals.

## 2. Define queue payload minimization and immutable intent

Queue and outbox payloads should normally contain identifiers, versions, hashes, and bounded display hints rather than private order contents, uploaded text, personal funds, session data, or unrestricted request bodies.

The payload must still bind the original intent tightly enough to prevent confused-deputy behavior:

```text
job_type
subject_id and subject_version
requested_action
requesting actor/system type
scope/visibility expectation
payload schema version
idempotency key
created_at
```

A worker rejects an unexpected payload version, target type, visibility transition, or action outside the job's allowlist.

## 3. Security notifications require deliberate recipient snapshots

Some notifications must go to an address that is changing.

Examples:

- notify the prior address that an owner-assisted email correction occurred;
- send verification to the replacement address;
- notify the current owner and incoming owner during ownership transfer;
- warn an address associated with a compromised session before account data changes again.

Deriving every destination from `users.email` at delivery time can send the message to the wrong address after a concurrent change. Storing unrestricted addresses forever in generic outbox payloads is also undesirable.

Requirements:

- the account transition transaction creates purpose-specific notification intents identifying the intended destination role, such as `prior_email`, `replacement_email`, `current_owner`, or `incoming_owner`;
- where an exact address snapshot is required, it is stored in a protected bounded notification-delivery record with explicit retention, redaction, and access policy rather than a generic public payload;
- delivery workers verify the related transition and notification intent remain valid without silently substituting the account's latest address;
- ordinary product notifications may resolve the current verified address at send time when that behavior is explicitly intended;
- account deletion, address correction, and legal/privacy holds define whether pending messages are cancelled, redacted, or still required for security;
- notification logs do not expose addresses or sensitive subject text unnecessarily.

## 4. Prevent deleted or withdrawn data from being resurrected

A late worker must not recreate derived rows or objects after the source was deleted, redacted, quarantined, or withdrawn.

This applies to:

- extraction drafts and corrected payloads;
- sanitized public evidence artifacts;
- search indexes and cache entries;
- translations and summaries;
- confidence/trust projections;
- generated exports;
- thumbnails/previews;
- object-storage copies and backups created after a deletion cutoff.

Requirements:

- source records carry lifecycle/security generations checked by workers before commit;
- derived writes use composite expected-state conditions or locks so deletion/withdrawal wins deterministically;
- a worker that loses the race removes any temporary output and records cancellation;
- projection rebuilds consume deletion/anonymization/tombstone events and cannot infer removed private associations from retained data;
- restore and replay tooling applies withdrawal/deletion events before republishing derived indexes or artifacts;
- object cleanup reconciles temporary, final, quarantined, withdrawn, and orphaned objects.

## 5. Make generated exports and downloads revocable where possible

A generated export may finish after the user cancels it, deletes the order, loses authorization, or closes the account.

Requirements:

- export jobs use the exact sealed order snapshot and export-policy version requested;
- generation checks current authorization and lifecycle state before creating the downloadable object;
- downloadable objects are private, randomly addressed, short-lived, and authorized at access time;
- revocation or deletion blocks future downloads and schedules object cleanup;
- permanent files already downloaded to a user's device cannot be remotely revoked, and product language must not imply otherwise;
- export objects and delivery URLs never become public cache keys or analytics dimensions;
- regeneration creates a new export identity rather than mutating the contents behind an old download reference.

## 6. Queue failure must not create false product state

A database commit may succeed while email, extraction, cache invalidation, or object cleanup remains pending or fails.

Requirements:

- user-visible status distinguishes committed core state from pending secondary processing;
- no page claims an evidence artifact is public before the public object and publication transition are both verified;
- no support workflow claims a security notice was delivered merely because it was queued;
- dead-letter state is visible to the owner/operations surface with a safe retry or bounded manual resolution;
- retrying a dead-lettered job preserves original intent and idempotency rather than creating a different action;
- safety-critical withdrawal and cache invalidation receive escalation when propagation does not complete within a defined bound;
- metrics count cancelled/superseded jobs separately from failures.

## 7. Required eleventh-pass tests

Tests must prove:

- an extraction job queued before upload deletion cannot recreate an extraction draft afterward;
- a public-artifact job queued before privacy withdrawal cannot publish the artifact;
- a disabled/deleted account's stale contribution job cannot create a public proposal or review;
- a security notice intended for the prior email is not silently redirected to a replacement address;
- an ownership-transfer message reaches the deliberately selected destination roles despite concurrent account edits;
- a cancelled export cannot later become downloadable;
- a projection rebuild does not recreate deleted facility associations or collapsed deleted-contributor identities;
- restore/replay does not republish an artifact whose later withdrawal event exists;
- a queued-but-undelivered email is displayed as pending/failed rather than sent;
- a dead-letter retry cannot apply a different payload under the original idempotency key.

## Eleventh-pass result

The durable outbox and worker model also require a durable authorization and lifecycle rule:

```text
Valid enqueue
  + immutable bounded intent
  + execution-time state validation
  + generation/expected-state write
  + idempotent side effect
  + cancellation and dead-letter visibility
```

Without that sequence, delayed workers can bypass newer privacy, security, and withdrawal decisions.

No executable migration, runtime worker, queue, account state, object, database, or production system is changed by this review.
