# AAR — SPEC-MEMO-READINESS-WIRE-1 — Canonical fact key case fix in memo input reader

**Date:** 2026-05-15
**Status:** ✅ CODE SHIPPED — V-3/V-4 pending Vercel deploy + OmniCare recompute
**Commit:** `8f66cc50` (squash-merged to main)
**PR:** #434
**Branch:** `spec/memo-readiness-wire-1`
**Deal under observation:** OmniCare 365 (`80fe6f7a-5c68-4f02-8bcf-933f246a9fc5`)

---

## 1. Objective

Close the case-mismatch bug in `loadRequiredFinancialFacts` that prevented the memo readiness evaluator from ever seeing financial facts, blocking the entire spreads → memo pipeline for every deal on every bank.

---

## 2. §0 Verification (pre-fix)

All four preconditions confirmed on `main` at `fada52a1` before any edits.

### §0.1 — Reader code
`buildMemoInputPackage.ts:279-284` contained the offending `.in()` clause with lowercase strings `"dscr"`, `"annual_debt_service"`, `"global_cash_flow"`, `"loan_amount"`. Confirmed verbatim match to spec.

### §0.2 — Registry code
`keys.ts` defines all four entries with UPPERCASE `fact_key` values:
- `DSCR` → `fact_key: "DSCR"`
- `ANNUAL_DEBT_SERVICE` → `fact_key: "ANNUAL_DEBT_SERVICE"`
- `GLOBAL_CASH_FLOW` → `fact_key: "GLOBAL_CASH_FLOW"`
- `BANK_LOAN_TOTAL` → `fact_key: "BANK_LOAN_TOTAL"`

### §0.3 — Live data (OmniCare 365)

```
fact_key             | n
---------------------+---
GLOBAL_CASH_FLOW     | 1
```

- **Zero rows** for all lowercase variants (`dscr`, `annual_debt_service`, `global_cash_flow`, `loan_amount`).
- **Zero rows** for `DSCR`, `ANNUAL_DEBT_SERVICE`, `BANK_LOAN_TOTAL` — confirms Bug 4 (aggregator not writing these canonical keys). This is out of scope for this slice and becomes the next spec target.
- **One row** for `GLOBAL_CASH_FLOW` — confirms the reader case-fix will immediately resolve `missing_global_cash_flow`.

### §0.4 — Readiness row (OmniCare 365)

```
readiness_score:     48
financials_complete: false
evaluated_at:        2026-05-14 19:23:01.302+00
blockers:
  - missing_collateral_item          (owner: banker)
  - missing_dscr                     (owner: buddy)
  - missing_debt_service_facts       (owner: buddy)
  - missing_global_cash_flow         (owner: buddy)
  - missing_research_quality_gate    (owner: buddy)
  - unfinalized_required_documents   (owner: banker)
```

All preconditions satisfied. Proceeded with implementation.

---

## 3. Bug fixed

### Primary — fact key case mismatch (the wall between spreads and memo)

`loadRequiredFinancialFacts` queried `deal_financial_facts.fact_key` with lowercase strings. The canonical fact registry and all writers use UPPERCASE. The `.in()` clause matched zero rows on every deal, so the readiness evaluator always fired `missing_dscr`, `missing_debt_service_facts`, and `missing_global_cash_flow` — capping `readiness_score` below threshold and blocking memo generation.

**Fix:** Reader now sources keys from `CANONICAL_FACTS` registry via a `REQUIRED_FACT_KEYS` constant. The `.in()` clause and all `latest.get()` lookups use the registry values. A future registry rename propagates automatically.

### Secondary — latent column name bug

The `select()` clause referenced `period_end`. The actual column is `fact_period_end` (confirmed via `information_schema.columns`). supabase-js silently drops unknown columns in select strings, so the bug was invisible at runtime — the function never used the period value downstream. Corrected defensively in the same edit.

---

## 4. Changes

| File | Change |
|------|--------|
| `src/lib/creditMemo/inputs/buildMemoInputPackage.ts` | Added `CANONICAL_FACTS` import. Replaced `loadRequiredFinancialFacts` to use `REQUIRED_FACT_KEYS` constant sourced from registry. Fixed `period_end` → `fact_period_end` in select. |
| `src/lib/creditMemo/inputs/__tests__/loadRequiredFinancialFacts.guard.test.ts` | New. 2 pure source-grep guard tests: (1) reader imports and references all 4 `CANONICAL_FACTS.*.fact_key` entries, no lowercase `"dscr"` in `.in()`. (2) Registry defines all 4 entries with uppercase `fact_key`. |

**Diff stats:** 2 files, +94 −11 lines.

---

## 5. Test results

| Suite | Result |
|-------|--------|
| New guard test (2 tests) | ✅ 2/2 pass |
| `pnpm guard:all` | ✅ 184/184 pass |
| `tsc --noEmit` | ✅ clean |

---

## 6. V-N Verification

### V-1 — Code shipped ✅
Commit `8f66cc50` on `main`. `loadRequiredFinancialFacts` imports `CANONICAL_FACTS`, uses `REQUIRED_FACT_KEYS` constant, no lowercase `"dscr"` literal in function body.

### V-2 — CI
PR #434 merged via local squash-merge. `guard:all` (184/184) and `tsc --noEmit` passed locally pre-push. Vercel CI pending on push.

### V-3 — OmniCare readiness row ⏳ PENDING
Requires Vercel deploy of `8f66cc50` + recompute trigger (visit Memo Inputs page or call assembler endpoint for deal `80fe6f7a-5c68-4f02-8bcf-933f246a9fc5`).

**Expected outcome:** `missing_global_cash_flow` drops from blockers. `missing_dscr` and `missing_debt_service_facts` likely persist (Bug 4 — aggregator not writing those keys). `financials_complete` may remain `false`. Pass criterion: Buddy-owned blocker set is **strictly smaller** than pre-fix.

### V-4 — Reader/registry contract ⏳ PENDING
Will run post-deploy:
```sql
SELECT fact_key, fact_value_num
FROM deal_financial_facts
WHERE deal_id = '80fe6f7a-5c68-4f02-8bcf-933f246a9fc5'
  AND fact_key IN ('DSCR','ANNUAL_DEBT_SERVICE','GLOBAL_CASH_FLOW','BANK_LOAN_TOTAL')
  AND NOT is_superseded;
```

---

## 7. Residual bugs (next spec slices)

| Bug | Description | Sizing signal from §0.3 |
|-----|-------------|------------------------|
| Bug 2 | Reader has no DSCR→GCF_DSCR fallback. If `DSCR` absent but `GCF_DSCR` exists, `missing_dscr` still fires. | `GCF_DSCR` row exists on OmniCare (value null — see Bug 3). |
| Bug 3 | `GCF_DSCR` row has `fact_value_num = null`. Root cause in `computeGlobalCashFlow.ts` denominator resolution. | Blocks Bug 2 fallback even if implemented. |
| Bug 4 | Aggregator (`runCashFlowAggregator` / `backfillFromSpreads`) does not write canonical `DSCR` or `ANNUAL_DEBT_SERVICE` keys. 10 successful spread runs on OmniCare, 393 financial facts, zero rows for either key. | 0 rows for both. This is the next spec target. |

---

## 8. Exceptions

**§2.2 deviation — pure source-grep vs runtime import.** The spec's guard test imported `CANONICAL_FACTS` at runtime. `keys.ts` has `import "server-only"` at line 1, which crashes under `node --test --import tsx`. Replaced with a pure `readFileSync` source-grep pattern per established convention (memory: "CI guard test files must import from pure modules"). Same invariants asserted, no coverage loss.

**No other deviations from spec.**

---

## 9. Lessons

1. **Same bug class as T-85-PROBE-1.** That probe found `value_numeric` vs `fact_value_num` column mismatch and `_IS` suffix key mismatch in the SBA forward model. This slice found lowercase vs UPPERCASE key mismatch in the memo reader. Both are "query-string doesn't match schema" bugs that produce zero rows and silent null cascades. The guard test pattern (source-grep for registry references) is the right structural defense.

2. **supabase-js silent column drops.** The `period_end` column name in `select()` was wrong for an unknown duration. supabase-js doesn't error on non-existent column names — it silently omits them from the response. This makes typo bugs in select strings invisible until someone reads the actual query. Worth a broader sweep of `select()` calls against `information_schema.columns`.
