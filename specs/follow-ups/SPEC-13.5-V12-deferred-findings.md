# SPEC-13.5 V-12 Deferred — Three Additional Blocker Layers

## Context
SPEC-13.5 PR-A successfully fixed the silently broken legacy→canonical
migration. The canonical store now has 4 borrower_story rows and 4
management_profile rows, telemetry fires on every migration call, and
the wrapper throws on writer failure.

V-12 (banker walks deal end-to-end through Submit) cannot pass on the
backfilled test deals because the readiness contract has additional
gates beyond canonical-input population:

## Three remaining blocker layers

### Layer 1 — Borrower story sub-fields beyond business_description
The contract requires both business_description (≥20 chars) AND
revenue_model (≥10 chars). OmniCare Review's legacy `deal_memo_overrides`
did not include `revenue_mix`, so the canonical row has business_description
but NULL revenue_model. The "Buddy found suggested inputs" UI offers
Accept buttons that would populate this — verify whether that path writes
through to canonical correctly. If not, this is its own bug.

### Layer 2 — Financial computation pipeline
DSCR, annual_debt_service, global_cash_flow are all NULL on backfilled
deals despite 188+ raw financial facts existing in deal_financial_facts.
The fact_keys in production are UPPERCASE (GROSS_RECEIPTS, K1_ORDINARY_INCOME)
but the readiness contract queries for lowercase canonical keys
(dscr, annual_debt_service, global_cash_flow). Either the readiness
query is wrong, or computed metrics are derived at memo-build time
not stored as facts. Investigate.

### Layer 3 — Research quality gate
OmniCare Review has a completed research mission with gate_passed=false,
trust_grade='manual_review_required', quality_score=0. Either the
research pipeline is genuinely failing quality checks, or the gate is
misconfigured. Investigate before any V-12 walk.

### Layer 4 — Document finalization
"Buddy is still processing N required documents" persists. Either
documents legitimately need banker confirmation, or the finalization
signal isn't propagating. Investigate.

## Recommendation
File three sequential specs (SPEC-13.6 / .7 / .8) addressing layers 2/3/4.
Layer 1 is likely resolved by the existing "Buddy found suggested inputs"
Accept flow if it writes correctly to canonical — verify before specifying.

## V-12 deferred until
All four layers either resolve or are explicitly out-of-scope.

## V-11 deferred for the same reasons as V-6

Fresh-deal V-12 walk (V-11 in the SPEC-13.5 V-N checklist) is deferred
along with V-6. The fresh-deal walk requires the same readiness gates to
unlock as the backfilled-deal walk: financial computation pipeline
(Layer 2), research quality gate (Layer 3), document finalization
(Layer 4). Layer 1 (borrower_story sub-fields) is the only gate a fresh
deal could plausibly clear via the wizard rewire alone — but every
other gate above remains blocked.

PR-B's structural acceptance is therefore B-1..B-5 (tests + curl/grep
checks). The "road walkable for new deals" verification stays deferred
until layers 2/3/4 resolve.

**Decision (2026-05-07):** PR-B ships on structural acceptance. V-11
remains ⏸ until SPEC-13.6/7/8 close.

## SPEC-13.5 Option A consequence — BankerReviewPanel UI-state non-persistence

PR-B routed BankerReviewPanel UI-state writes (tabs_viewed,
qualitative_override_*, covenant_adjustments, committee_*) to the legacy
/credit-memo/overrides POST shim. The shim no-ops + telemetry-pings;
these fields therefore do NOT persist after page reload.

Impact:
- tabs_viewed: banker re-clicks tabs to re-mark "viewed" on reload (mild
  UX friction, not blocking)
- qualitative_override_*: banker re-enters score + reason if they reload
  before submitting (annoying; readiness gate doesn't depend on these)
- covenant_adjustments: banker re-enters covenant Keep/Modify/Remove
  decisions if they reload (annoying; submit doesn't enforce these)

None of these fields gate submission, so the road remains walkable.

Resolution: build a separate canonical store for banker UI-state
(deal_banker_review_state) with its own canonical writer endpoint.
Migrate any persisted UI-state from deal_memo_overrides at the same time.
File as SPEC-13.9 (companion to SPEC-13.6 borrower-story sub-fields).
*(Note: numbering revised from SPEC-13.7 → SPEC-13.9 because SPEC-13.7
and SPEC-13.8 were taken below for borrower-flow + cockpit-endpoint
deprecations discovered during PR-C.)*

## SPEC-13.5 cleanup chain (filed during PR-C, 2026-05-07)

Three follow-up specs queued for the SPEC-13.5 cleanup chain. Each
unblocks a specific allowlist entry in
`scripts/check-no-legacy-overrides-writes.sh`. Day-15 PR-D table drop
is gated on all three closing.

- [`SPEC-13.6-...`](#) — borrower_story sub-fields and downstream
  blocker layers from V-12 walk (Layers 2/3/4 above).
- [`SPEC-13.7-builder-story-canonical-migration.md`](./SPEC-13.7-builder-story-canonical-migration.md)
  — borrower-flow journey writers
  (`builderCanonicalWrite.ts:writeStoryCanonical` and
  `borrower/update/route.ts`). 17 unique fields across both files.
- [`SPEC-13.8-cockpit-memo-overrides-deprecation.md`](./SPEC-13.8-cockpit-memo-overrides-deprecation.md)
  — cockpit-side `/memo-overrides` PATCH endpoint. Consumer audit then
  migrate-or-deprecate decision.

These three follow-ups close the legacy/canonical split entirely. Once
they ship, the CI guard's allowlist is empty and the legacy table can
be dropped.
