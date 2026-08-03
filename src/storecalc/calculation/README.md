# StoreCalc calculation core v1

This directory implements the bounded pure-core portion of StoreCalc delivery
slice 4. The authoritative product contract remains
`docs/storecalc-implementation-contract.md`; this file records the exact v1
implementation choices used by code and tests.

## Boundary

`calculateStoreCalcOrder()` has no database, locale, clock, session, filesystem,
or network dependency. Callers must resolve the configuration, supported
capabilities, facility-local context date, quantities, and optional private
funds before invocation. The function accepts no client totals and returns only
JSON-safe values. All authoritative arithmetic uses `BigInt` internally.

This slice does **not** add an endpoint, browser calculator, persistence,
facility catalog, profile composition, fee rule, inventory claim, order
submission, or production feature activation. The anonymous calculator gate
remains closed.

## Supported capabilities

- `money.minor_units.v1`
- `quantity.bounded_integer.v1`
- `tax.single_treatment.line_rounding.v1`
- `spending_buckets.parallel_pretax.v1`
- `constraints.order_aggregate.v1`

Configurations declare every capability they use. Unknown capabilities,
missing caller capabilities, unrecognized schema/contract/canonicalization
versions, and content-hash mismatches fail before calculation.

## Exact v1 semantics

- Money and quantities cross the boundary as canonical base-10 strings.
- Numeric strings are length-bounded before `BigInt` conversion, and all
  collections have fixed cardinality limits. Warnings are capped across the
  entire resolved configuration, not separately per item.
- V1 supports the reviewed `USD`/two-decimal pairing only. Other currency codes
  or exponents fail closed until added to the explicit allowlist. No conversion
  occurs.
- A selected quantity must meet the item's minimum, maximum, and step.
- Every selected item has one tax treatment: known, not applicable, unknown, or
  unsupported.
- Known tax uses parts per million and line-level `half_up`, `floor`, or
  `ceiling` rounding. Tax-inclusive treatment derives the tax component from
  the listed line total; tax-exclusive treatment adds tax to it.
- Spending buckets run in parallel. `counts_toward` contributes the pre-tax
  item subtotal; `excluded` and `informational_only` do not. Bucket totals are
  never summed to produce the order total. Amount and limit uncertainty are
  reported independently, with `unsupported` taking precedence over `unknown`
  in the combined bucket result.
- V1 aggregate constraints support order-wide total quantity and distinct-line
  count with `<=` or `>=` comparison.
- Optional funds are private input in the order currency. Remaining funds are
  the only signed money result.
- The final total covers items and supported tax only. Facility fees remain
  explicitly `unsupported`, never a fabricated zero.

Unknown and unsupported states are not treated as zero, unlimited, or ready.
Structural incompatibility throws a bounded `StoreCalcCalculationError`.
Known rule violations appear in the returned validation list with one of the
contract severities.

## Canonical integrity

Resolved content and calculation results use
`storecalc.canonical-json.v1` plus SHA-256. Object keys and child collections
have deterministic ordering; short text must already be NFC and excludes
control and unsafe bidirectional characters. The calculation verifies the
sealed configuration hash before doing any arithmetic and returns a stable
result hash over the complete JSON-safe result. The result repeats the exact
required-capability set covered by that hash.

The synthetic fixtures under `test/fixtures/` are test data only. They make no
claim about Hays State Prison or any real facility, catalog, item, price, tax,
limit, audience, inventory, or acceptance rule.
