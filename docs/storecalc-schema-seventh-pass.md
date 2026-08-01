# StoreCalc Schema Seventh-Pass Review

Issues: #111, #109

Status: final material identity and launch-security corrections found during the seventh independent design review.

This pass concentrates on catalog identity continuity, contribution eligibility, and protection of the high-impact owner account-support powers.

## 1. Stable catalog identities need explicit correction and lineage operations

A stable item ID across versions is valuable, but incorrect identity matching can permanently mix unrelated price and review history.

Examples:

- a package size changes and should become a new item;
- one old item is replaced by two new variants;
- two duplicated OCR entries are later recognized as one item;
- a SKU is reused for a materially different product;
- a name changes while the underlying product remains the same;
- an apparent rename is actually a different brand or unit size.

Stable keys must never be matched automatically from display name, SKU, barcode, price, or fuzzy similarity alone.

Use explicit catalog-identity events or an equivalent model supporting relationships such as:

```text
same_identity_confirmed
replaces
split_from
merged_duplicate_of
related_variant
identity_match_rejected
```

Requirements:

- sealed version rows keep the item identity they originally referenced;
- correcting identity creates new stable identities and lineage events rather than rewriting sealed versions;
- a duplicate merge does not collapse historical order lines or version snapshots;
- a split does not pretend all prior history belongs to each successor;
- proposal diffs show identity decisions separately from display-name and price changes;
- extraction/import suggestions are drafts requiring contributor confirmation;
- confidence and price history do not cross an unconfirmed identity boundary;
- reversal/correction of a mistaken identity event is append-only and audited;
- category identity uses equivalent safeguards where continuity matters.

## 2. Define account assurance for public contribution privileges

Anonymous calculation must remain open, and private account use should not be unnecessarily blocked. Public contribution surfaces, however, need a clear assurance policy.

Before community publication launches, define which actions require:

- a signed-in account;
- verified email;
- minimum account age or completed cooldown where abuse risk warrants it;
- additional rate limits for new accounts;
- stronger review before public evidence publication;
- no assurance beyond ordinary ownership for private drafts and private templates.

Likely public-assurance actions include uploads intended for publication, public proposals, weighted accuracy reviews, facility requests, and public comments.

Rules:

- email verification is a friction/communication control, not proof of identity or correctness;
- users without verification can still calculate anonymously and should not encounter a dead end for basic StoreCalc use;
- account age or verification never outweighs evidence;
- assurance requirements are enforced server-side and included in abuse tests;
- disabled or recovery-limited accounts cannot use stale sessions to contribute;
- the product explains why an action requires verification without exposing anti-abuse thresholds unnecessarily.

## 3. Add a stronger authentication gate before owner recovery powers launch

The owner dashboard can change account emails, disable accounts, issue recovery tokens, alter roles, and transfer ownership. Those capabilities make the owner account a high-value target.

Recent password reauthentication is necessary but should not be the only long-term protection before these powers launch.

The owner-management release needs a separately reviewed strong-authentication plan, preferably supporting a phishing-resistant factor such as a passkey/WebAuthn credential, with a safe backup/recovery design. An equivalent strong second factor may be used if reviewed.

Requirements:

- sensitive owner actions require a recent strong-authentication assertion bound to the current session and action class;
- ownership transfer, recovery-token issuance, email correction, role change, and disabling another administrator receive the strongest gate;
- enrollment and removal of owner factors are themselves audited sensitive actions;
- backup credentials/recovery material are limited, revocable, and never displayed after creation;
- losing the ordinary factor does not create an unrestricted bypass—the bounded break-glass procedure remains the emergency path;
- factor metadata does not become visible to ordinary administrators or support screens;
- session invalidation follows factor compromise or owner transfer.

This requirement may be delivered before the owner recovery routes rather than before the earliest calculator/directory slices.

## 4. Prevent self-amplification in request and review counts

The contributor's own submission must not also count as an independent supporting vote or accuracy confirmation.

Requirements:

- a facility-request creator is not counted again as a supporter;
- a proposal submitter cannot cast a weighted review on that proposal;
- a public evidence uploader does not create a second independent evidence group merely by confirming the same upload;
- profile/fork authors cannot manufacture confidence through related private copies;
- system/import actors do not count as community users;
- public counts distinguish submissions, independent reviewers, and independent evidence groups.

## 5. Make public status language precise

StoreCalc is community-maintained and does not control facility inventory or acceptance.

Public pages and completed-order output should clearly distinguish:

- catalog accuracy/confidence;
- applicability confidence;
- source/effective date;
- known warnings or unsupported rules;
- facility acceptance or live stock, which StoreCalc does not guarantee;
- a finalized calculation from an order actually submitted or accepted by a facility.

Labels such as `verified`, `official`, `accepted`, or `available` require precise definitions and must not imply endorsement by a correctional agency unless that relationship genuinely exists and is documented.

## 6. Required seventh-pass tests

Before public contribution and owner recovery launch, tests must prove:

- fuzzy name/SKU similarity cannot silently reuse a stable item identity;
- a split, merge, replacement, or mistaken identity correction preserves sealed versions and orders;
- unverified/new accounts receive the configured public-contribution restrictions without losing anonymous calculator access;
- a submitter cannot increase independent review/support/evidence counts through the submitter's own actions;
- a stale password-only session cannot perform an action requiring recent strong owner authentication;
- public status text and completed-order output do not imply live inventory or facility acceptance.

## Seventh-pass result

The remaining material correction is that identity itself is versioned knowledge:

```text
Catalog row similarity
  -> proposed identity relationship
      -> reviewed identity event
          -> stable history without rewriting sealed facts
```

And high-impact administration has a separate launch gate:

```text
Current owner authorization
  + recent reauthentication
  + strong factor
  + bounded support case
  + transactional audit
```

No production database, runtime route, or executable migration is changed by this review.