# StoreCalc Schema Final Clarifications

Issues: #111, #109

These requirements close contradictions found after the hostile review. Executable migrations must satisfy this document together with the main design and prior review addenda.

## Cross-template copy and fork provenance

`template_versions.based_on_version_id` is correctly restricted to a version in the same template. That field describes revision ancestry within one template.

It cannot also describe copying a public template into a new private template because the source version belongs to another template.

Use a separate immutable provenance relationship equivalent to:

```text
template_forks
  child_template_id
  child_initial_version_id
  source_template_id
  source_version_id
  source_content_hash
  created_by_user_id
  created_at
```

Required behavior:

- the source version must belong to the source template;
- the child initial version must belong to the child template;
- the child and source templates must differ;
- access to a private source is checked and locked at copy time;
- a public source version remains historically addressable;
- deletion of a private source account/template must not erase the copied child's content;
- provenance may be anonymized or tombstoned, but never rewritten to a different source;
- fork relationships reject self-links and cycles where later copy workflows could create them.

A copied template owns independent stable item/category identities after creation. Source identities remain provenance, not shared mutable catalog rows.

## Remove fixed main/exempt authoritative totals

The corrected limit model supports arbitrary named and overlapping buckets. An item may count toward both an overall commissary cap and a category-specific cap.

Therefore these conceptual order columns are not suitable as authoritative schema:

```text
main_subtotal_minor
exempt_subtotal_minor
```

`exempt` is also ambiguous: tax-exempt and limit-exempt are different facts.

The authoritative order header should contain only non-overlapping monetary totals such as:

```text
items_subtotal_minor
tax_total_minor
fee_total_minor when supported
final_total_minor
```

Every applicable spending limit is recorded in `order_bucket_totals`, including its stable key, name snapshot, limit, amount counted toward the limit, and remaining/overage value.

Rules:

- bucket totals are parallel constraints and must never be summed to derive the item subtotal;
- an amount counted in two buckets is intentionally present in both bucket totals;
- the primary bucket is a display/navigation hint, not the source of the order subtotal;
- tax exemption is represented by resolved tax rules, not by a spending bucket name;
- unknown limits produce explicit warnings and do not receive a fabricated remaining amount.

## Explicit immutable version warnings

The main design says unknown limits must not be treated as unlimited but does not provide a clear immutable home for that fact.

Add a sealed child structure equivalent to:

```text
version_warnings
  id
  version_id
  warning_code
  severity
  scope_type
  category_version_id
  item_version_id
  message_key
  bounded_details
  created_at
```

Examples include unknown_overall_limit, uncertain_tax_rule, incomplete_sheet, unreadable_source_area, and eligibility_not_confirmed.

Warnings participate in the version content hash. Free-form details are bounded and must not contain personal information.

## Evidence at seal versus later evidence

Distinguish two relationships:

- sealed source evidence: part of the factual package used to create and hash the version;
- later corroborating or conflicting evidence: append-only context added after sealing.

Later evidence must not change the sealed content hash. It may change confidence, dispute state, or produce a replacement proposal.

Evidence withdrawal preserves a tombstone, content hash, relationship type, withdrawal reason, and audit event while removing public access to unsafe artifact bytes.

## Assessment and projection constraints

Confidence assessments require:

- a documented bounded score range;
- one unsuperseded assessment per version and algorithm version;
- immutable factor snapshots;
- explicit supersession rather than update-in-place;
- deterministic rebuild tests for any current-state projection.

Current review positions, current version states, and current publication pointers are rebuildable projections over append-only events. Projection loss must not destroy factual history.

## State-machine enforcement

Text `CHECK` constraints limit vocabulary but do not enforce valid transitions.

Proposal, correction-report, support-case, upload, evidence, order, and publication workflows require transition services that:

- lock the current row/state;
- verify the expected prior state;
- append an event/audit record;
- update a projection only when allowed;
- reject skipped, repeated, or backward transitions unless a named reversal workflow permits them;
- use idempotency keys for retried actions.

Tests must exercise invalid transitions directly against service and database boundaries.

## System actors

Publication, assessment, import, notification, and moderation events may be produced by a controlled system worker rather than a human account.

Event and audit models must distinguish:

- human user actor;
- owner/admin actor;
- fixed system actor/job type.

Do not create a fake ordinary user account whose credentials or deletion control automated history. System actor identifiers are fixed allowlisted values with bounded job/request correlation IDs.

## Completed-order publication context

A completed order always references its exact template version. When the order began from a public template, it may also snapshot the publication ID or publication interval that made the version current at that time.

This is explanatory provenance only. Private templates and deliberately selected archived versions may have no publication reference.

The order remains valid even when the public template later changes, is disputed, or is replaced.

## Final gate

Before executable SQL begins, the implementation schema must present one internally consistent model that incorporates these corrections rather than copying the earlier conceptual column lists literally.