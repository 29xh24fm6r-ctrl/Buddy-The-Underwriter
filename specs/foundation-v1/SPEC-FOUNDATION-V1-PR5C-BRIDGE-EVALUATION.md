# SPEC-FOUNDATION-V1-PR5C — Aggregator Bridge Re-Evaluation

**Path:** `specs/foundation-v1/SPEC-FOUNDATION-V1-PR5C-BRIDGE-EVALUATION.md`
**Status:** Ready for Claude Code (small scope — 0.5 to 1 day, includes a decision deliverable)
**Owner:** Matt (architecture) → Claude Code (implementation + decision recommendation)
**Branch:** opens against `feat/foundation-v1-pr5c-bridge-evaluation`
**Depends on:** PR5a + PR5b merged
**Sequence position:** 3 of 4

---

## Problem in one paragraph

After PR5a + PR5b, the canonical chain produces correct DSCR for fresh deals AND self-heals on lifecycle events. The route's `runCashFlowAggregator` is now called from two places: (1) the Classic Spread route (the original workaround), and (2) inside `spreadsProcessor` (the canonical chain bridge added by PR5a). The aggregator's role has become ambiguous: is it a deprecated workaround that should be deleted, or is it a permanent bridge module that the canonical chain depends on? PR5c produces the decision: deprecate or keep.

## Solution in one paragraph

Run a verification pass on `runCashFlowAggregator`'s necessity. Two experiments: (1) test whether the canonical chain produces correct DSCR without the aggregator (temporarily disable it inside spreadsProcessor); (2) test whether the route still needs the aggregator now that PR5b triggers cover it. Write a finding document recommending one of three paths: keep both call sites, deprecate route call only, or deprecate entirely. PR5c does NOT execute the deprecation — it produces the recommendation.

## PIV — pre-implementation verification

### PIV-1. Confirm Samaritus is post-PR5a/PR5b baseline

```sql
SELECT fact_key, fact_value_num, provenance->>'extractor' AS extractor, updated_at
FROM deal_financial_facts
WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd'
  AND fact_key IN ('CASH_FLOW_AVAILABLE', 'ANNUAL_DEBT_SERVICE', 'DSCR', 'GCF_DSCR')
  AND is_superseded = false
ORDER BY fact_key;
```

### PIV-2. Identify what `computeTotalDebtService` would produce without aggregator

Read `src/lib/structuralPricing/computeTotalDebtService.ts` and `src/lib/financialFacts/backfillFromSpreads.ts`. Does any other path populate `CASH_FLOW_AVAILABLE` before `computeTotalDebtService` runs?

### PIV-3. Confirm both aggregator call sites

```bash
grep -n 'runCashFlowAggregator' src/app/api/deals/\[dealId\]/classic-spread/route.ts
grep -n 'runCashFlowAggregator' src/lib/jobs/processors/spreadsProcessor.ts
```

---

## Scope

### In scope

1. **Investigation: canonical chain without aggregator inside spreadsProcessor.** Temporarily no-op the aggregator call; trigger spread recompute on Samaritus; observe if `computeTotalDebtService` produces DSCR from other inputs.

2. **Investigation: route aggregator call necessity.** With PR5b's triggers, does the route need its own aggregator call?

3. **Finding document at `specs/foundation-v1/findings/SPEC-FOUNDATION-V1-PR5C-BRIDGE-EVALUATION-FINDING.md`.** Three options (keep both / deprecate route call / deprecate entirely) + recommended option.

4. **No production code changes** beyond temporary investigation patches (reverted before merge).

### Hard non-goals

- Do not deprecate the aggregator in this PR. Recommendation only.
- Do not commit investigation patches.

---

## V-N verification checklist

V-1 through V-7 per spec body (PIVs, investigations, finding doc, clean diff).

---

## Hand-off commit message

```
spec(foundation): SPEC-FOUNDATION-V1-PR5C-BRIDGE-EVALUATION — bridge evaluation finding

Investigates whether runCashFlowAggregator is still necessary after PR5a + PR5b.
Produces finding with three options and recommendation. No code changes.

This is PR5c of 4.

Spec: specs/foundation-v1/SPEC-FOUNDATION-V1-PR5C-BRIDGE-EVALUATION.md
Governs under: SPEC-BANKER-HOLY-SHIT-V1 Workstream B
```
