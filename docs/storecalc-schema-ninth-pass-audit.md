# StoreCalc Ninth-Pass Audit

> Historical review record. Its accepted conclusions are consolidated in
> `storecalc-implementation-contract.md`; this file is not an implementation
> source.

Issues: #111, #109

Status: no new material conceptual flaw identified in this pass.

This pass uses a fixed audit checklist rather than introducing another design direction. It reviews the accumulated architecture and eight corrective passes for missing boundaries, contradictions in intent, or an unaddressed high-impact failure mode.

This result does not claim that future implementation cannot contain bugs. It means this independent conceptual pass did not identify another material requirement that must be added before consolidation.

## Audit checklist

### Identity and lineage

Reviewed:

- facilities, aliases, merges, and temporal fact history;
- agencies and physical/governing jurisdiction separation;
- shared programs and facility applicability;
- templates, immutable versions, forks, base/profile composition, and resolved configuration;
- stable category/item identity plus split/merge/replacement history;
- order, proposal, evidence, review, contributor-subject, and system-actor lineage;
- same-parent composite constraints and cycle prevention.

Result: no new material gap found.

### Time and publication

Reviewed:

- system time versus claimed effective date;
- facility timezone;
- applicability and publication intervals;
- non-overlap and concurrency;
- late discovery, future scheduling, withdrawal, fallback, and supersession;
- completed-order historical context.

Result: no new material gap found.

### Calculation and rule semantics

Reviewed:

- exact integer money and currency exponent;
- tax resolution and rounding scope;
- overlapping monetary limits;
- per-item and aggregate non-monetary constraints;
- unknown values and fail-closed capability handling;
- base/profile compatibility and deterministic composition;
- personal funds boundary;
- authoritative server calculation, validation snapshots, hashes, and regression tests.

Result: no new material gap found.

### Community review and trust

Reviewed:

- separate content and applicability claims;
- immutable proposals and append-only review positions;
- structured correction reasons;
- evidence independence and grouping;
- scoped trust, self-review prevention, new-account limits, and usage-versus-accuracy separation;
- confidence composition and explicit publication decisions;
- identity corrections and translation review.

Result: no new material gap found.

### Privacy and data lifecycle

Reviewed:

- anonymous calculation and shared-device storage;
- current facility, follows, orders, funds, uploads, and private templates;
- public attribution and cross-facility unlinkability;
- analytics, logs, caches, referrers, notifications, exports, and search counts;
- account deletion, pseudonymous retained history, derived projections, backups, and object retention;
- provisional-to-canonical facility behavior.

Result: no new material gap found.

### Authorization and security

Reviewed:

- viewer-scoped access and non-enumeration;
- account status and session invalidation;
- CSRF/origin/content-type protection;
- rate limits, quotas, idempotency, stale revisions, and concurrency;
- upload quarantine, file validation, SSRF defense, and evidence publication;
- owner versus administrator capability, recent database-backed authorization, strong factor, last-owner protection, and bounded break-glass recovery;
- append-only audits and safe trigger/function ownership.

Result: no new material gap found.

### Operations and recovery

Reviewed:

- incremental migrations, exact checksums, ownership/grants, locks, timeouts, and disposable rehearsal;
- expand-contract deployment and feature gates;
- rollback without destructive live-data down migrations;
- outbox, jobs, dead letters, monitoring, emergency withdrawal, and cache invalidation;
- database/object manifests, restore reconciliation, and private/public scope preservation.

Result: no new material gap found.

### User-facing product surface

Reviewed:

- anonymous access without a registration dead end;
- phone-first and unreliable-network behavior;
- accessibility and non-color status communication;
- disambiguated search;
- versioned translations;
- sealed print/download provenance;
- honest language about confidence, unknown rules, stock, submission, and facility acceptance.

Result: no new material gap found.

## Remaining gates, not new flaws

The following are already identified requirements and remain incomplete work:

1. Consolidate the architecture and all accepted corrections into one authoritative implementation contract.
2. Mark the exploratory/review documents as superseded for implementation purposes while preserving them as design history.
3. Build a traceability matrix mapping every requirement to schema constraints, service behavior, route authorization, and tests.
4. Explicitly list deferred capabilities such as historical period ledgers, multiple personal funding accounts, advanced tax components, public order sharing, and automatic official-source imports.
5. Review the consolidated contract once more before writing executable SQL.
6. Design and test the first bounded migration separately; do not treat documentation CI as database verification.

## Ninth-pass conclusion

No new material conceptual flaw was identified in this pass.

The current remaining risk is not another missing idea. It is implementation drift caused by corrections being spread across multiple documents. Therefore the next correct action is consolidation, followed by a fresh review of the consolidated contract.

No production database, runtime route, executable migration, authentication behavior, or deployment is changed by this audit.
