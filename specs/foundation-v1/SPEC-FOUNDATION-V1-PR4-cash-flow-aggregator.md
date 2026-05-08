# SPEC-FOUNDATION-V1 PR4 — Cash Flow Aggregator

**Status:** Ready for Claude Code (substantial scope — multi-session)
**Owner:** Matt (credit policy lock) → Claude Code (implementation)
**Branch:** opens against `feat/foundation-v1-pr4-cash-flow-aggregator`
**Depends on:** SPEC-FOUNDATION-V1 PR1, PR2, PR3 all merged
**Blocks:** Closes the `dscr_computed` blocker for every deal that has tax returns + K-1s + PFS

## Problem in one paragraph

The submit-time readiness contract checks `dscr_computed` via `memo.financial_analysis.dscr.value !== null`. The DSCR is sourced via `computeDscrGlobal` in `factsAdapter.ts`, which reads from the GLOBAL_CASH_FLOW spread's rendered DSCR row, with a fallback to the `DSCR` fact directly. **For Samaritus, the GLOBAL_CASH_FLOW spread is correctly shaped with formula references but every DSCR row has `value: null`** because the upstream inputs (`CASH_FLOW_AVAILABLE`, `ANNUAL_DEBT_SERVICE`) are never written to `deal_financial_facts`. The 169 raw extractions for Samaritus include all the inputs needed (tax return line items, K-1 ordinary income, depreciation, PFS data) but no aggregator combines them into the canonical metrics. **This is the THE financial pipeline gap — the missing module that translates raw fact extractions into computed cash flow metrics.**

## Solution in one paragraph

Build a deterministic aggregator module at `src/lib/financialFacts/cashFlowAggregator.ts` that, on demand for a given deal+bank, (1) reads all raw fact extractions per the registered fact_keys, (2) groups them by entity (borrower business + each affiliate) and by guarantor (each principal), (3) computes per-entity Business OCF using the Form 1084 + SBA SOP 50 10 8 methodology, (4) computes per-guarantor Personal Net Cash Flow using the worst-of-three living expense method, (5) consolidates to total CashFlowAvailable applying pro-rata affiliate ownership, (6) computes AnnualDebtService from deal-level debt schedule + proposed loan, (7) computes Base/Stress A/Stress B/Stress C DSCRs, (8) writes all computed values back to `deal_financial_facts` with full provenance. Triggered automatically when fact extractions complete (extends the existing pipeline) and via a recompute endpoint for manual triggers. Per-tenant policy via `bank_underwriting_policies` table (default = conservative tier). All thresholds, stress scenarios, and methodology choices documented in spec are encoded as deterministic functions with unit tests asserting every line-item adjustment.

## PIV — pre-implementation verification

### PIV-1. Confirm all required canonical fact_keys are registered

```bash
grep -A 2 "CASH_FLOW_AVAILABLE\|ANNUAL_DEBT_SERVICE\|EBITDA\|GLOBAL_CASH_FLOW\|GCF_DSCR\|DSCR_STRESSED_300BPS" \
  src/lib/financialFacts/keys.ts
```

**Expected:** confirms `CASH_FLOW_AVAILABLE`, `ANNUAL_DEBT_SERVICE`, `ANNUAL_DEBT_SERVICE_PROPOSED`, `ANNUAL_DEBT_SERVICE_EXISTING`, `EBITDA`, `GLOBAL_CASH_FLOW`, `GCF_DSCR`, `DSCR`, `DSCR_STRESSED_300BPS`, `EXCESS_CASH_FLOW` all present in the canonical registry. Confirmed already during research.

### PIV-2. Identify the existing fact extraction pipeline trigger

```bash
grep -rn "extractFactsFromDocument\|materializeFactsFromArtifacts\|onFactExtraction" \
  src/lib/financialFacts/ src/lib/jobs/processors/
```

**Expected:** identify the pipeline endpoint where the aggregator should hook in.

### PIV-3. Confirm the spread renderer reads computed facts back

```bash
grep -A 15 "computeDscrFromSpreads\|GLOBAL_CASH_FLOW.*rendered_json" \
  src/lib/creditMemo/canonical/factsAdapter.ts
```

**Expected:** confirms the renderer reads the spread, which reads facts. After PR4 writes facts, the spread will render the DSCR value automatically (existing renderer infrastructure).

### PIV-4. Identify the proposed-loan rate / amortization data path

```bash
grep -rn "loan_amount\|interest_rate\|amortization_months" src/db/schema.ts src/lib/deals/ 2>/dev/null
```

**Expected:** identify how the proposed loan terms are stored. PR4 must compute proposed P&I from these fields.

### PIV-5. Identify the existing debt schedule data path

```bash
grep -rn "deal_existing_debt\|debt_schedule\|existing_debt" src/db/schema.ts src/ 2>/dev/null
```

**Expected:** identify the existing debt schedule table or field. If absent, PR4 must spec the schema addition.

## Scope — broken into 4 sub-PRs (PR4a, PR4b, PR4c, PR4d)

PR4 is too large to ship as a single PR. It breaks into four sub-PRs that ship independently and can be merged sequentially:

### PR4a — Aggregator core: per-entity Business OCF

Builds `src/lib/financialFacts/cashFlowAggregator/computeBusinessOCF.ts`:

- Reads tax return facts for one entity for one period
- Applies Form 1084 line-by-line adjustments (depreciation add-back, amortization add-back, interest expense add-back, non-recurring income subtractions, etc.)
- Applies SBA SOP 50 10 8 adjustments per the conservative methodology lock
- Returns `{ ebitda: number, ocf: number, addBacks: AddBackDetail[], subtractions: SubtractionDetail[], provenance: FactProvenance[] }`

Owner W-2 add-back logic:
- Accepts a `dealContext: { isChangeOfOwnership: boolean, sellerExitConfirmed: boolean, buyerCompFairMarketDocumented: boolean }` parameter
- Add-back only when ALL three conditions are true (per conservative lock)

Comprehensive unit tests covering:
- C-Corp (Form 1120) construction
- S-Corp (Form 1120S) construction
- Partnership (Form 1065) construction
- Sole prop (Schedule C) construction
- Owner W-2 add-back conditional logic
- Mortgages-payable-in-1yr always-subtracted rule
- Non-recurring income classification

### PR4b — Aggregator core: per-guarantor Personal Net Cash Flow

Builds `src/lib/financialFacts/cashFlowAggregator/computePersonalNetCashFlow.ts`:

- Reads PFS facts + 1040 facts + K-1 distribution facts for one guarantor for one period
- Computes inflows: W-2, interest, dividends, net rental, K-1 distributions (Box 16D / Box 19A only — never Box 1)
- Computes outflows: federal/state taxes, real estate taxes, personal debt service, K-1 capital contributions
- Computes living expense via worst-of-three method (Method A: $25K + $7,500/dependent; Method B: 18% AGI; Method C: $36K single / $48K joint floor)
- Returns `{ personalInflows, personalOutflows, livingExpense, netCashFlow, livingExpenseMethodUsed, provenance }`

Per-tenant policy hook for living expense method selection (default = `max_of_three`).

Comprehensive unit tests covering:
- Single guarantor / joint guarantor
- Each living expense method individually
- Worst-of-three selection logic
- K-1 distributions vs. Box 1 ordinary income (Box 1 NEVER counted)
- K-1 capital contributions always subtracted

### PR4c — Aggregator: consolidation + DSCR + stress

Builds `src/lib/financialFacts/cashFlowAggregator/consolidate.ts`:

- Reads BusinessOCF for borrower + each affiliate (per pro-rata ownership share)
- Reads PersonalNetCashFlow for each guarantor
- Reads existing debt schedule + proposed loan terms
- Computes:
  - `cashFlowAvailable = Σ(BusinessOCF[borrower]) + Σ(BusinessOCF[affiliate_i] × ownership_i) + Σ(PersonalNetCashFlow[guarantor_j])`
  - `annualDebtService = ExistingBusinessDebtPI + ExistingPersonalDebtPI + ProposedLoanPI - DebtPaidOffAtClosing - DebtOnFullStandby`
  - `baseDSCR = cashFlowAvailable / annualDebtService`
  - `stressA_DSCR = cashFlowAvailable / DebtServiceAt(rate + 300bps)`
  - `stressB_DSCR = cashFlowAvailable_at_85_pct_revenue / annualDebtService`
  - `stressC_DSCR = cashFlowAvailable_at_85_pct_revenue / DebtServiceAt(rate + 300bps)`
- Writes all to `deal_financial_facts` via `writeFact` with provenance

Affiliate pro-rata logic: only the borrower's pro-rata share of affiliate EBITDA contributes (per conservative lock). Tested with multiple affiliate ownership scenarios.

Contingent liability logic: every personal guarantee adds annual P&I to global debt service (per conservative lock).

### PR4d — Pipeline integration + per-tenant policy + CI guard

Hooks the aggregator into the existing fact extraction pipeline:
- After `materializeFactsFromArtifacts` completes for a deal, automatically trigger `runCashFlowAggregator(dealId, bankId)`
- Provides recompute endpoint: `POST /api/deals/[dealId]/cash-flow/recompute`
- Creates `bank_underwriting_policies` table per the parent spec; defaults are the conservative tier
- Aggregator reads tenant policy and applies methodology per configuration (default = conservative)

CI guards:
- Source-level guard asserting the conservative defaults are not silently overridden in code
- Source-level guard asserting `computeBusinessOCF` includes the owner-W-2-conditional-add-back logic
- Source-level guard asserting `computePersonalNetCashFlow` does NOT reference `Box 1` / `ordinary_income` on the personal-side
- Source-level guard asserting `consolidate.ts` includes the pro-rata affiliate logic
- Integration test: synthetic deal walks tax-return facts → aggregator → DSCR fact written → spread renders → readiness gate clears

Submission gate update: `evaluateMemoReadinessContract` is updated to enforce the conservative DSCR thresholds (1.20x base / 1.00x stress for SBA Small ≤$350K, scaling per loan path). Existing 1.0x check is the SBA SOP minimum; PR4d updates it to 1.20x base + 1.00x stress C.

### Out of scope (deferred to SPEC-FOUNDATION-V2)

- UCA cash flow model (more sophisticated than EBITDA + adjustments). Documented in research as future enhancement.
- T12 / TTM rendering in non-CRE memo paths (handled by PR3 audit).
- Multi-currency support.
- Real-time aggregator triggered on every fact extraction (current design: triggered after materialization completes, not per-fact).
- Forecast-based projected cash flow (the SOP allows projected basis; current scope is historical only). Projected handled by separate spec.
- Sources & uses analysis for change-of-ownership transactions (separate spec).

## V-N verification checklist (parent — each sub-PR has its own)

- V-1. ☐ PR4a merged: BusinessOCF computable per entity per period.
- V-2. ☐ PR4b merged: PersonalNetCashFlow computable per guarantor per period.
- V-3. ☐ PR4c merged: Consolidated DSCRs (Base, A, B, C) computable per deal.
- V-4. ☐ PR4d merged: Pipeline integrated, per-tenant policy active, CI guards passing.
- V-5. ☐ Run aggregator against Samaritus → DSCR facts written.
- V-6. ☐ GLOBAL_CASH_FLOW spread re-renders with non-null DSCR values.
- V-7. ☐ `evaluateMemoReadinessContract` against Samaritus: `dscr_computed` blocker now `false` (gate clears).
- V-8. ☐ All 5 readiness blockers (dscr_computed, loan_amount, collateral_value, business_description, management_bio) cleared.
- V-9. ☐ Browser walk: Samaritus → /deals/0279ed32-c25c-4919-b231-5790050331dd/credit-memo → BankerReviewPanel readiness checklist all green → submit button reachable → snapshot inserted with status='banker_submitted'.
- V-10. ☐ Audit ledger contains `deal.lifecycle.advanced` event for the submission (or `deal.lifecycle.advance_attempted` if `committee_ready` blockers exist; either is acceptable).

## Files affected (estimated)

| Path | Change | Risk |
|------|--------|------|
| `src/lib/financialFacts/cashFlowAggregator/computeBusinessOCF.ts` | New | Med |
| `src/lib/financialFacts/cashFlowAggregator/computePersonalNetCashFlow.ts` | New | Med |
| `src/lib/financialFacts/cashFlowAggregator/consolidate.ts` | New | Med |
| `src/lib/financialFacts/cashFlowAggregator/index.ts` | New | Low |
| `src/lib/financialFacts/cashFlowAggregator/__tests__/*.test.ts` | New (multi-file) | Low |
| `src/app/api/deals/[dealId]/cash-flow/recompute/route.ts` | New | Med |
| `src/lib/jobs/processors/factMaterializationProcessor.ts` | Hook trigger | Med |
| `supabase/migrations/<timestamp>_create_bank_underwriting_policies.sql` | New | Med |
| `src/lib/creditMemo/submission/evaluateMemoReadinessContract.ts` | Update DSCR threshold to 1.20x base + 1.00x stress | High — submit gate |
| `src/lib/creditMemo/__tests__/dscrThresholdGuard.test.ts` | New | Low |

## Risk register

1. **Aggregator runs on every deal but legacy deals don't have all required raw extractions.** Mitigated: aggregator returns `{ ok: false, reason: 'incomplete_extractions', missing: [...] }` when inputs are missing. Existing deals see incremental improvement as documents complete.
2. **Methodology drift over time.** Mitigated: every methodology choice is encoded as a named constant referenced from spec. Unit tests assert constants haven't drifted. CI guards prevent silent changes.
3. **Performance: aggregator runs synchronously.** For deals with many entities/guarantors, computation could be slow. Mitigated: aggregator is fact-cache-friendly (writes facts once, reads many); spread renderer reads from facts. Worst case: aggregator runs as background job (similar to spread janitor).
4. **DSCR threshold change is breaking.** The current threshold check in `evaluateMemoReadinessContract` is `dscr.value !== null` (any positive value passes). PR4d adds quantitative thresholds (1.20x base + 1.00x stress C). Existing deals at DSCR 1.05–1.19 that previously could submit can no longer. **This is the conservative posture working as designed.** Bank tenants with looser policies can configure via `bank_underwriting_policies`.
5. **Scenario complexity in stress tests.** Stress B (15% revenue compression) requires identifying which facts represent revenue and which represent fixed costs. Mitigated: methodology research locks revenue facts to `GROSS_RECEIPTS` / `TOTAL_REVENUE` / `REVENUE`; fixed costs to depreciation, interest, fixed lease payments. Variable cost handling per Form 1084 conventions.

## Hand-off commit message (parent — each sub-PR has its own)

```
feat(foundation): cash flow aggregator (SPEC-FOUNDATION-V1 PR4)

Builds the deterministic aggregator that reads raw fact extractions
and writes computed CASH_FLOW_AVAILABLE + ANNUAL_DEBT_SERVICE + DSCR
+ stress DSCRs to deal_financial_facts. Implements the conservative-tier
institutional methodology locked in SPEC-FOUNDATION-V1 parent.

Sub-PRs:
- PR4a: per-entity Business OCF (Form 1084 + SBA SOP 50 10 8)
- PR4b: per-guarantor Personal Net Cash Flow (worst-of-three living expense)
- PR4c: consolidation + Base/A/B/C DSCR (pro-rata affiliates, contingent liabilities)
- PR4d: pipeline integration + per-tenant policy + CI guards

After all sub-PRs merge, the GLOBAL_CASH_FLOW spread renders
deterministically with populated DSCR for every deal that has
the required raw extractions, end-to-end submission becomes
possible, and the submission readiness gate becomes computable
from raw fact extractions forward.
```
