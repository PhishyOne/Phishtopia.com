# StoreCalc Schema Fifth-Pass Review

Issues: #111, #109

Status: mandatory calculation-model corrections found during the fifth independent design review.

This pass focuses on rule expressiveness, shared catalogs with facility-specific differences, unknown values, deterministic calculation, compatibility, and verification. It supplements the earlier reviews until the consolidated implementation contract replaces them.

## 1. Avoid full catalog forks for every scoped rule difference

A shared agency catalog may use the same items and prices across hundreds of facilities while taxes, spending limits, eligibility, or a handful of blocked items vary by facility or audience.

Creating a complete independent template fork for every small difference would:

- duplicate large catalogs;
- fragment item corrections and evidence;
- require repeated review of unchanged content;
- make statewide catalog updates difficult to propagate;
- create misleading independent-confidence counts;
- recreate the duplication trap that shared programs were introduced to solve.

The design needs an explicit immutable composition model. One acceptable approach separates:

```text
base_template_version
  catalog items, prices, shared categories, shared rules

applicability_profile_version
  facility/audience-specific taxes, limits, availability, or eligibility deltas

resolved_configuration
  base version ID + profile version ID(s) + deterministic composition version + hash
```

Equivalent designs are acceptable if they preserve the same guarantees.

Requirements:

- overlays/profiles are explicit, immutable, evidence-backed, versioned, and publicly inspectable;
- there are no hidden mutable facility overrides;
- the allowed override domains are fixed and validated;
- a profile cannot alter stable identity lineage outside its allowed scope;
- conflicts between base and profile rules follow documented deterministic composition semantics;
- orders reference every component and the final resolved-configuration hash;
- proposal comparison shows base changes separately from scoped profile changes;
- confidence and disputes remain attributable to the component containing the disputed fact;
- a complete facility-specific fork remains available when the catalog truly diverges substantially.

The first release may support only a complete single version, but the schema contract must preserve an extension point for explicit composition rather than forcing permanent copy proliferation.

## 2. Applicability must resolve one compatible effective configuration

Facility, audience, time, assignment, base publication, and profile publication must resolve as one compatible set.

The resolver must reject:

- a profile built for a different base template lineage unless an explicit compatibility range permits it;
- a profile whose effective interval does not cover the requested order date/context;
- two equally authoritative profiles affecting the same rule domain without a defined combination;
- a base/profile combination that requires unsupported calculator capabilities;
- a current assignment that points to withdrawn or inaccessible components.

Resolution returns a structured explanation of every selected component. It never guesses based on names, newest timestamps alone, or insertion order.

Completed orders snapshot the resolved component IDs, hashes, effective dates, and resolver version.

## 3. Declare calculation capabilities on every sealed component

Unknown rule types already fail closed, but compatibility must be testable before calculation begins.

Every sealed template/profile version should declare concepts equivalent to:

```text
calculation_contract_version
required_capabilities
content_schema_version
canonicalization_version
```

Examples of capabilities include:

- monetary spending buckets;
- per-item quantity steps;
- aggregate quantity constraints;
- tax-inclusive line rounding;
- item exclusion rules;
- mutually exclusive groups.

Rules:

- the server refuses to calculate or publish a component requiring unsupported capabilities;
- the public interface displays an honest unsupported/incomplete state rather than ignoring rules;
- stale client JavaScript may render a basic warning, but never becomes the authoritative calculator;
- capability changes require versioned engine tests and cannot retroactively change sealed results;
- completed orders record the engine and contract versions used.

## 4. Support aggregate constraints beyond money

Monetary buckets and per-item quantity limits do not represent every facility rule.

Real rules may include:

- maximum total units from a category;
- maximum number of distinct line items;
- maximum combined weight;
- choose no more than one item from a group;
- mutually exclusive products;
- required multiples or package combinations;
- maximum count across several specific items;
- a monetary limit plus a separate unit-count limit over the same items.

Use an explicit typed constraint model or an equivalent bounded rule structure. One possible shape is:

```text
version_constraints
  id
  version_or_profile_id
  constraint_type
  measure_type
  comparator
  limit_value
  unit_code nullable
  scope_type
  composition_behavior
  priority

constraint_memberships
  constraint_id
  item/category/group target
  contribution_value or measurement rule
```

Requirements:

- `measure_type` distinguishes money, quantity, distinct-line count, weight, and each supported measure;
- units are explicit and compatible;
- rule composition is deterministic;
- unsupported constraints create a sealed warning and prevent a false compliant/ready result;
- time-period limits requiring prior purchase history are not treated as order-only constraints;
- the first implementation may deliberately support a subset, but the limitation is explicit and testable.

## 5. Model unknown values without fabricating zero or unlimited

Several conceptual columns currently require values even when a source is incomplete.

Examples:

- unreadable or unknown item price;
- uncertain tax treatment;
- unknown quantity maximum;
- unknown spending limit;
- item known to exist but not currently orderable from available evidence.

Do not overload `NULL` inconsistently or insert zero as a placeholder.

Use an explicit value-state policy such as:

```text
known
unknown
not_applicable
not_supported
```

Rules:

- an unknown price item may be displayed as informational but cannot be added to an authoritative order;
- zero price is a real known value and is not synonymous with unknown;
- null monetary limit means unlimited only where the schema explicitly defines that meaning;
- uncertain tax or eligibility produces a warning and prevents an unqualified compliant label;
- source extraction confidence does not become an authoritative value state until reviewed;
- unknown states participate in hashes and historical snapshots.

## 6. Define composition behavior, not only priority

A numeric priority cannot by itself explain how two rules interact.

Each rule/constraint domain needs documented behavior such as:

- most-specific override;
- additive components;
- minimum-of-limits;
- maximum-of-requirements;
- all-must-pass;
- exactly-one selection;
- mutually exclusive;
- informational only.

Rules with the same specificity and incompatible behavior are rejected as ambiguous. Insertion order, database row order, or accidental ID order must never decide a calculation.

Tax composition remains deliberately narrow in the first release: one resolved effective tax treatment per item unless explicit component grouping is later added.

## 7. Use one authoritative calculation core

Anonymous calculation, authenticated drafts, completed orders, proposal previews, review comparisons, and administrative verification must all call the same server-side calculation domain service or the same versioned pure core.

Requirements:

- client JavaScript provides responsive previews but is never authoritative;
- every persisted save and completion recalculates on the server;
- the server accepts quantities and user inputs, not client-computed totals;
- calculation output includes resolved rules, bucket/constraint outcomes, warnings, validation results, and hashes;
- no separate admin or import calculator may implement subtly different rule semantics;
- the pure core has no database, clock, locale, or network dependency except through explicit inputs.

## 8. Separate formatting from monetary authority

Locale-specific input and display must not alter stored values.

Requirements:

- authoritative amounts are exact integer minor units plus currency exponent;
- parsing uses explicit locale/context and rejects ambiguous input rather than guessing;
- grouping symbols, decimal symbols, translated labels, and currency placement are display concerns;
- API boundaries use validated decimal strings when values may exceed safe JavaScript number range;
- `BigInt` values are never silently coerced through `Number`;
- order hashes use canonical numeric strings independent of display locale.

## 9. Define the personal-funds boundary explicitly

The first release may support one optional available-funds value in the order currency.

It must not imply support for:

- multiple institutional accounts;
- restricted funding sources;
- reservations from other pending orders;
- automatic account balance synchronization;
- foreign-exchange conversion;
- historical transaction ledgers.

If a facility requires separate personal funding balances for different purchase classes, StoreCalc must either add an explicit multi-fund model or display that the rule is not currently representable. It must not pretend one total balance proves affordability.

## 10. Build verification around calculation invariants

Before calculation code is accepted, tests should include:

- golden fixtures for representative catalogs and expected totals;
- property tests for nonnegative totals, stable recalculation, and ordering independence;
- overflow and maximum-bound tests;
- cross-version regression fixtures proving old orders still reproduce;
- randomized rule ordering proving insertion order cannot change results;
- base/profile compatibility and conflict tests;
- unknown-value tests proving zero/unlimited are never fabricated;
- capability mismatch tests proving unsupported rules fail closed;
- aggregate quantity/count/weight constraint tests;
- client-preview versus server-authoritative comparison tests;
- canonical hash fixtures that remain stable across supported runtime upgrades.

The test vectors and engine version form part of the long-term calculation contract.

## 11. Required fifth-pass tests

The schema and service test matrix must attempt and reject:

- cloning a full catalog solely because one facility has a different tax when an explicit scoped profile is the intended model;
- applying a facility profile to an incompatible base version;
- resolving two ambiguous scoped profiles by row order;
- calculating a version requiring an unsupported capability;
- treating a category unit cap as a monetary bucket;
- adding an item whose price state is unknown;
- treating zero price as unknown or unknown limit as unlimited;
- changing results by reordering otherwise identical rule rows;
- trusting client-provided totals;
- formatting or locale conversion changing an authoritative hash;
- one personal balance being represented as support for multiple restricted funding accounts.

## Fifth-pass result

The effective order input is now understood as:

```text
facility + audience + time
  -> applicability
      -> immutable base catalog version
      -> zero or more explicit compatible scoped profile versions
          -> deterministic resolved configuration + hash
              -> authoritative calculation + validation snapshot
```

This adds complexity where the real world contains complexity, while keeping that complexity explicit, immutable, reviewable, and reproducible.

No production database, runtime route, or executable migration is changed by this review.