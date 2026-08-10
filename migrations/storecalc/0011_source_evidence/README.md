# StoreCalc migration 0011: sealed source evidence

This package adds the durable evidence identities required by the canonical
`storecalc.catalog-content.v1` hash and the seal-time relationship between a
template version, an evidence identity, and its reviewed source-lineage group.
It implements the bounded metadata-only subset of SC-CAT-008 and SC-EVD-003.

The migration requires the exact verified `0010_warnings` state. It creates no
rows and advances the closed `anonymous.calculation` schema marker from 7 to 8.
The capability remains unavailable and unverified.

## V1 identity boundary

`storecalc.evidence` accepts only an `external_citation` with:

- a bounded HTTPS URL with no whitespace, control characters, or URL userinfo;
- a bounded display title, optional conservative language tag, and optional
  source calendar date;
- explicit private or public-citation metadata visibility;
- explicit pending-review, metadata-safe, restricted, or withdrawn privacy
  state;
- metadata-only redistribution state; and
- one immutable lowercase SHA-256 normalized fingerprint.

No upload ID, raw or public object key, filename, artifact bytes, fetched
content, free-form metadata, or redistribution permission enters this table.
Evidence upload and artifact lifecycles remain separate launch-gated work.

`storecalc.evidence_groups` records one immutable source-lineage fingerprint.
Its state is unreviewed, accepted, disputed, or superseded. A group is a
deduplication/independence identity, not proof that a source is accurate or
official.

Evidence and group identity rows are immutable in this V1 slice. Later
withdrawal, grouping-review, reversal, and supersession work must add
append-only events before enabling any state transition. This prevents a
future service from silently rewriting the fingerprints already included in a
sealed version hash.

## Version relationship

`storecalc.version_source_evidence` binds one evidence identity and one source
group to the same draft template version with the single V1 relationship
`supports_catalog`.

The relationship trigger:

- serializes with template-version sealing through the existing topology lock;
- reuses the existing sealed-content mutation guard;
- accepts only metadata-safe, non-withdrawn, metadata-only evidence; and
- accepts only an active accepted source-lineage group.

The evidence and group fingerprints remain on their immutable identity rows.
The later sealing transaction will join them into the pure canonical catalog
document; this migration does not implement that transaction.

## Access, verification, and rollback

`PUBLIC`, the web role, and the worker role receive no table, sequence, or
trigger-function privilege. The backup role receives read-only access. Source
URLs and internal contributor links therefore remain outside the current
runtime surface.

The verifier checks the inherited schema and the exact new relations, columns,
check bodies, indexes, foreign keys, identity sequences, trigger bodies,
owners, persistence/RLS state, ACL allowlist, grants, and closed capability
state.

Rollback is allowed only while all three tables are empty and both identity
sequences have never been used. It verifies the complete current state before
mutation, removes only this slice, restores the closed marker to
`0010_warnings`, and verifies that exact baseline afterward. Any drift, later
dependency, inserted identity, link, or sequence use fails before mutation.

## Explicit deferrals

Private uploads, extraction, artifact storage or publication, evidence-group
events, withdrawal/context events, contributor routes, external URL fetching,
source confidence, public citation rendering, canonical database extraction,
the sealing transaction, publication, applicability, profiles, orders, real
catalog rows, runtime catalog grants, and production execution remain absent.

This migration is not authorized for production execution. SC-OPS-002
rehearsal and an independently reviewed SC-OPS-004 execution path are still
required.
