# Shadow EBITDA validation report

**Spec:** SPEC-FINENGINE-SHADOW-EBITDA-1 — first real execution of `finengine.core`, validating EBITDA.
**Mode:** read-only / report-only. No canonical fact written (NG1). No cutover, no flag flip.
**Branch:** `claude/finengine-shadow-ebitda` · base `main`.

---

## What this validates
EBITDA is the leaf metric everything depends on and the home of the **C-corp waterfall fix**. The
legacy EBITDA on OmniCare is **−457,567** (`deal_spreads:T12:v3`, superseded) — the worst year's raw
taxable income with **no add-backs** (the C-corp bypass bug). This report proves the new engine
restores interest + D&A and produces a financially-correct EBITDA, diffed against a golden-set
**derived independently from the tax facts** (NG2 — a separate code path, never reverse-engineered
from the method output).

## Harness delivered (all green)
- `src/lib/finengine/shadow/dealInputAdapter.ts` — facts → one `SpreadInputs` per (owner, period); period alignment, `1900-01-01` aggregate sentinel, missing-component warnings.
- `src/lib/finengine/shadow/ebitdaGoldenSet.ts` — independent EBITDA / ADJUSTED golden (base + interest + D&A; owner-comp **excess** only; §179 **acceleration** only).
- `src/lib/finengine/shadow/runEbitdaShadow.ts` — invokes the REAL `adjustedEbitdaMethod` + `coreOperatingEarnings`, builds the golden-set, classifies via `compareProducers`.
- `scripts/finengine-shadow-ebitda.ts` — read-only runner over live deals (deploy-env).
- `src/lib/finengine/__tests__/shadowEbitda.test.ts` — 9 tests. `tsc` 0 errors · `guard:all` green.

## Method-level proof (V2) — faithful OmniCare-shaped fixture
A C-corp fixture whose worst year carries raw `TAXABLE_INCOME = −457,567` (the exact bug value), plus
the live ranges (`INTEREST_EXPENSE` 94k–395k, `DEPRECIATION` 61.7k–210k, `OFFICER_COMPENSATION`
200k–325k):

| Year | base (TAXABLE_INCOME) | + interest | + depreciation | **engine EBITDA** | independent golden | legacy | class |
|---|---|---|---|---|---|---|---|
| 2022 (worst) | −457,567 | 395,000 | 210,000 | **+147,433** | +147,433 | −457,567 | INTENDED |
| 2021 | 300,000 | 200,000 | 120,000 | **+620,000** | +620,000 | — | INTENDED |
| 2020 (no interest) | 250,000 | 0 ⚠ | 61,700 | **+311,700** | +311,700 | — | INTENDED |

Result: **engine EBITDA ≠ −457,567 in every period**, equals the independent golden, classified
**INTENDED**; `report.unexpected = 0`, `cutoverBlocked = false`. The classifier itself is proven to
flag a −457,567 output as **UNEXPECTED** (harness integrity test). **The C-corp fix works.**

---

## Live run — PENDING (infrastructure)
The live OmniCare numbers are **not yet in this report**: the Supabase MCP read channel returned
continuous `502 Bad Gateway` (Anthropic proxy) throughout this session, and the runner script needs
deploy-env service credentials not present in this sandbox. The logic above is fully validated; only
the substitution of live fact values remains. To complete (read-only, writes nothing):

```
pnpm tsx --conditions=react-server scripts/finengine-shadow-ebitda.ts 80fe6f7a-5c68-4f02-8bcf-933f246a9fc5
```
and the §5 verification queries:
```sql
SELECT fact_key, count(*) n, count(*) FILTER (WHERE NOT is_superseded) live
FROM deal_financial_facts WHERE deal_id='80fe6f7a-5c68-4f02-8bcf-933f246a9fc5'
  AND fact_key IN ('M1_TAXABLE_INCOME','TAXABLE_INCOME','INTEREST_EXPENSE','DEPRECIATION','OFFICER_COMPENSATION','TAX_LIABILITY','TOTAL_TAX')
GROUP BY 1 ORDER BY 1;
SELECT deal_id, fact_value_num, provenance->>'source_ref' src, is_superseded
FROM deal_financial_facts WHERE fact_key='EBITDA';
```

The author/operator pastes the runner output's per-year rows here; expected outcome per §3/§6:
every OmniCare year's engine EBITDA ≠ −457,567 and ≈ the documented golden → INTENDED.

## V-check status
- **V1** runner + report harness delivered ⚠ live emit pending (MCP/deploy).
- **V2** C-corp fix proven at method level (engine +147,433 vs bug −457,567) ✅; live OmniCare substitution pending.
- **V3** classifier flags any UNEXPECTED + sets `cutoverBlocked` ✅ (harness-integrity test).
- **V4** `guard:all` + `tsc` green; **no canonical fact written** ✅ (read-only; the live EBITDA query still shows only the superseded −457,567).

## Next step
When the live run confirms only ZERO/INTENDED, the fast-follow `SPEC-FINENGINE-CUTOVER-EBITDA-1`
makes finengine the EBITDA writer (`engine='finengine.core'`) behind a metric switch, flipped ON for
EBITDA only.
