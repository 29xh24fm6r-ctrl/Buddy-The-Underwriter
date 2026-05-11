# SPEC-FOUNDATION-V1-PR5A — Fix computeTotalDebtService Prerequisites

**Path:** `specs/foundation-v1/SPEC-FOUNDATION-V1-PR5A-COMPUTE-PREREQ-FIX.md`
**Status:** Ready for Claude Code (multi-day scope — 1 to 3 days depending on PIV findings)
**Owner:** Matt (architecture) → Claude Code (implementation)
**Branch:** opens against `feat/foundation-v1-pr5a-compute-prereq-fix`
**Depends on:** SPEC-FOUNDATION-V1 PR4-EXTRACT merged, PR4-SPREAD-DIAGNOSIS finding merged
**Governs under:** SPEC-BANKER-HOLY-SHIT-V1 Workstream B (revised — diagnostic + remediation arc)
**Sequence position:** 1 of 4 (PR5a → PR5b → PR5c → PR5d)

---

## Problem in one paragraph

The PR4-SPREAD-DIAGNOSIS finding established that the canonical compute chain (`spreadsProcessor` → `computeTotalDebtService` → `persistGlobalCashFlow` → GLOBAL_CASH_FLOW spread render) is architecturally correct but operationally fragile. For Samaritus, `computeTotalDebtService` ran during canonical spread processing on 2026-04-03 and produced zero DSCR-related facts because its prerequisites were not met at the time. Specifically, `computeTotalDebtService` queries `FINANCIAL_ANALYSIS.CASH_FLOW_AVAILABLE` to compute DSCR (verified: `src/lib/structuralPricing/computeTotalDebtService.ts` line 138-145), but no upstream module reliably writes that fact to `deal_financial_facts` before `computeTotalDebtService` runs in the spreadsProcessor chain. The aggregator (`runCashFlowAggregator`) writes `CASH_FLOW_AVAILABLE`, but the aggregator only runs from the Classic Spread route — not from the spreadsProcessor pipeline.

## Solution in one paragraph

Make the canonical chain self-sufficient by ensuring `computeTotalDebtService`'s prerequisite facts are present in `deal_financial_facts` before it executes. Two-part fix: (1) call `runCashFlowAggregator` from inside `spreadsProcessor` BEFORE `computeTotalDebtService` runs, so `CASH_FLOW_AVAILABLE` and `ANNUAL_DEBT_SERVICE` are populated when `computeTotalDebtService` reads them; (2) update `computeTotalDebtService` to handle the case where `CASH_FLOW_AVAILABLE` is still null (graceful degradation: write what it can, emit a structured `MISSING_PREREQ_NOI` event, do not silently produce zero facts). This preserves `runCashFlowAggregator` as a working module (PR5c will re-evaluate its long-term role) while fixing the canonical chain to produce DSCR for fresh deals.

## PIV — pre-implementation verification

### PIV-1. Confirm computeTotalDebtService's NOI query target

```bash
grep -n 'fact_key.*CASH_FLOW_AVAILABLE\|noiFact' src/lib/structuralPricing/computeTotalDebtService.ts
```

**Expected:** confirms `computeTotalDebtService` queries `FINANCIAL_ANALYSIS.CASH_FLOW_AVAILABLE` (not `NOI`, not `NET_OPERATING_INCOME`) for its DSCR computation. If divergent, surface to Matt — the diagnostic finding's open question 2 needs revision before this PR proceeds.

### PIV-2. Confirm spreadsProcessor's call order

```bash
grep -n 'computeTotalDebtService\|persistGlobalCashFlow\|backfillCanonicalFactsFromSpreads\|runCashFlowAggregator' src/lib/jobs/processors/spreadsProcessor.ts
```

**Expected:** `backfillCanonicalFactsFromSpreads` runs first (after spread render), then `computeTotalDebtService`, then `persistGlobalCashFlow`. NO call to `runCashFlowAggregator`. PR5a inserts a call to `runCashFlowAggregator` between `backfillCanonicalFactsFromSpreads` and `computeTotalDebtService`.

### PIV-3. Confirm aggregator handles "no NCADS" gracefully

```bash
grep -n 'no_ncads_candidates\|no_pricing_row' src/lib/financialFacts/runCashFlowAggregator.ts
```

**Expected:** the aggregator returns `{ ok: false, reason: ... }` for "no inputs" cases without throwing. PR5a relies on this — calling the aggregator inside spreadsProcessor must never throw, only return a structured result.

### PIV-4. Sample current Samaritus state (sanity check before/after)

Run via `the buddy supa mcp:execute_sql`:

```sql
SELECT 
  fact_type, fact_key, fact_value_num, 
  provenance->>'extractor' AS extractor,
  created_at
FROM deal_financial_facts
WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd'
  AND is_superseded = false
  AND fact_key IN (
    'CASH_FLOW_AVAILABLE', 'ANNUAL_DEBT_SERVICE', 'ANNUAL_DEBT_SERVICE_PROPOSED',
    'ANNUAL_DEBT_SERVICE_EXISTING', 'DSCR', 'DSCR_STRESSED_300BPS',
    'GCF_GLOBAL_CASH_FLOW', 'GCF_DSCR'
  )
ORDER BY fact_key;
```

Expected: per the diagnostic finding, four FINANCIAL_ANALYSIS facts exist with extractor `classicSpread:debtService:v1` (from PR4-PRECHECK execution). ANNUAL_DEBT_SERVICE_PROPOSED / EXISTING / DSCR_STRESSED_300BPS / GCF_GLOBAL_CASH_FLOW / GCF_DSCR likely missing. PIV-4 baselines this so V-N can confirm PR5a's effect.

### PIV-5. Confirm `enqueueSpreadRecompute` interface for PR5b dependency

```bash
grep -n 'export async function enqueueSpreadRecompute' src/lib/financialSpreads/enqueueSpreadRecompute.ts
```

**Expected:** function signature unchanged from current. Surfaced for awareness — PR5a does not call `enqueueSpreadRecompute`, but PR5b will.

---

## Scope

### In scope (this PR)

1. **Modify `src/lib/jobs/processors/spreadsProcessor.ts`** to call `runCashFlowAggregator` between `backfillCanonicalFactsFromSpreads` (existing line ~422) and `computeTotalDebtService` (existing line ~457). Wrap in try/catch; non-fatal on failure (log warning, continue). Log a ledger event `aggregator.canonical_run` with the result.

2. **Modify `src/lib/structuralPricing/computeTotalDebtService.ts`** to handle the case where `CASH_FLOW_AVAILABLE` fact is null even after the aggregator runs. When the NOI fact is missing, emit a `writeSystemEvent` with `error_code: "MISSING_PREREQ_NOI"` and `severity: "warning"` (not error — graceful degradation). Continue executing — write `ANNUAL_DEBT_SERVICE_PROPOSED`, `ANNUAL_DEBT_SERVICE_EXISTING`, and `ANNUAL_DEBT_SERVICE` (total) regardless. Skip DSCR computation when NOI is null but log the skip.

3. **Add unit test** for `computeTotalDebtService` covering the "NOI null" case: assert the function does not throw, writes the three ADS facts when pricing is present, skips DSCR fact write, and emits the `MISSING_PREREQ_NOI` event.

4. **Add integration test** (or test fixture) confirming the spreadsProcessor chain order: aggregator runs before `computeTotalDebtService`. The test mocks `runCashFlowAggregator` and asserts call ordering.

### Out of scope (PR5b/c/d)

- **Recompute triggers at lifecycle events** — PR5b.
- **Aggregator-as-canonical-bridge architectural decision** — PR5c will re-evaluate whether the aggregator stays in the spreadsProcessor chain permanently or gets deprecated once the canonical computeGlobalCashFlow path is proven self-sufficient.
- **Observability ledger events for canonical recompute** — PR5d.
- **Any change to `runCashFlowAggregator`'s logic.** It mirrors the route. PR5a only changes its callers.
- **Any change to `persistGlobalCashFlow`, `computeGlobalCashFlow`, or the spread template.** Out of scope.
- **Any change to the readiness contract.** Out of scope.

### Hard non-goals

- **Do not modify `runCashFlowAggregator`'s internal logic.** It mirrors the route exactly per PR4-EXTRACT. PR5a wires it as a caller; nothing else changes.
- **Do not delete or deprecate the route's call to `runCashFlowAggregator`.** That happens in a future deprecation spec after PR5b/c/d prove the canonical chain reliable.
- **Do not introduce new fact_keys.** The aggregator + computeTotalDebtService + persistGlobalCashFlow already cover the canonical fact set.
- **Do not change provenance shape.** Aggregator writes `extractor: "classicSpread:debtService:v1"`; computeTotalDebtService writes its own provenance. Don't unify in PR5a — provenance disambiguates which path wrote which fact.
- **Do not run the Classic Spread route during testing.** Use direct invocation of spreadsProcessor or unit tests with mocked dependencies.

---

## File-by-file change plan

### Modified files

| Path | Change | Risk |
|------|--------|------|
| `src/lib/jobs/processors/spreadsProcessor.ts` | Insert aggregator call between backfill and total-debt-service. ~10 lines added. | Medium — touches the canonical pipeline. Wrapped in try/catch; non-fatal. |
| `src/lib/structuralPricing/computeTotalDebtService.ts` | Add NOI-null graceful path. ~15 lines added. | Low — additive; existing happy-path unchanged. |

### New files

| Path | Purpose | Approx LOC |
|------|---------|------------|
| `src/lib/structuralPricing/__tests__/computeTotalDebtService.noi-null.test.ts` | Unit test for NOI-null graceful path | 60 |
| `src/lib/jobs/processors/__tests__/spreadsProcessor.aggregator-order.test.ts` | Integration test asserting aggregator runs before computeTotalDebtService | 80 |

---

## V-N verification checklist

V-1. ☐ All five PIV outputs pasted into AAR.
V-2. ☐ `spreadsProcessor.ts` calls `runCashFlowAggregator` after `backfillCanonicalFactsFromSpreads` and before `computeTotalDebtService`.
V-3. ☐ Aggregator call wrapped in try/catch with non-fatal warning log.
V-4. ☐ `computeTotalDebtService` handles `CASH_FLOW_AVAILABLE === null` without throwing; emits `MISSING_PREREQ_NOI` event.
V-5. ☐ Unit test for NOI-null path passes.
V-6. ☐ Integration test for aggregator-before-computeTotalDebtService order passes.
V-7. ☐ `pnpm tsc --noEmit` clean.
V-8. ☐ `pnpm test` clean across whole suite.
V-9. ☐ Samaritus manual verification SQL output captured in AAR.
V-10. ☐ Aggregator's provenance still distinct from computeTotalDebtService's provenance.

---

## Hand-off commit message

```
feat(financialFacts): wire runCashFlowAggregator into spreadsProcessor (SPEC-FOUNDATION-V1 PR5a)

Fixes the canonical compute chain's prerequisite gap. computeTotalDebtService
queries CASH_FLOW_AVAILABLE for DSCR computation but nothing in the canonical
chain populated that fact before computeTotalDebtService ran. PR5a inserts
runCashFlowAggregator between backfillCanonicalFactsFromSpreads and
computeTotalDebtService so the prerequisite is present.

Also adds graceful degradation: when CASH_FLOW_AVAILABLE is still null
after the aggregator runs, computeTotalDebtService emits MISSING_PREREQ_NOI
event and writes ADS facts but skips DSCR.

This is PR5a of 4 (PR5b: recompute triggers; PR5c: bridge re-evaluation;
PR5d: observability).

Spec: specs/foundation-v1/SPEC-FOUNDATION-V1-PR5A-COMPUTE-PREREQ-FIX.md
Governs under: SPEC-BANKER-HOLY-SHIT-V1 Workstream B
```
