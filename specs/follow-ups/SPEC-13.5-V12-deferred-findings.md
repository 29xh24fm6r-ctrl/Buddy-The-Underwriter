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
