# SPEC-FOUNDATION-V1-PR4-SPREAD-DIAGNOSIS — Finding

**Investigation date:** 2026-05-08
**Investigator:** Claude Code
**Spec:** `specs/foundation-v1/SPEC-FOUNDATION-V1-PR4-SPREAD-DIAGNOSIS.md`
**Deal investigated:** Samaritus Yacht Management (`0279ed32-c25c-4919-b231-5790050331dd`)

---

## 1. PIV outputs (raw)

### PIV-1 — Architecture summary verification

All 6 files verified against `main`. **No divergences detected.**

| File | Exists | Size | Match |
|------|--------|------|-------|
| `factsAdapter.ts` (`computeDscrGlobal`) | ✓ | 607 L | 3-tier fallback confirmed: GLOBAL_CASH_FLOW spread → T12 spread → FINANCIAL_ANALYSIS.DSCR fact |
| `globalCashFlow.ts` (DSCR row) | ✓ | 411 L | Uses `preferFactOrComputed`. Prefers DSCR fact; computed fallback uses CFA/ADS inputs. |
| `spreadsProcessor.ts` | ✓ | 1032 L | Calls `computeTotalDebtService` (line 656-677) then `persistGlobalCashFlow` (line 679-708), both post-render, both non-fatal. |
| `persistGlobalCashFlow.ts` | ✓ | 286 L | Calls `computeGlobalCashFlow` pure function, writes GCF_GLOBAL_CASH_FLOW + GCF_DSCR + GLOBAL_CASH_FLOW facts. |
| `computeGlobalCashFlow.ts` | ✓ | 207 L | Pure function, entity + sponsor aggregation, returns globalCashFlowAvailable + globalDscr. |
| `computeTotalDebtService.ts` | ✓ | 286 L | Writes 6 facts: ADS_PROPOSED, ADS_EXISTING, ADS total, DSCR, GCF_DSCR, DSCR_STRESSED_300BPS. |

### PIV-2 — Samaritus current state

**DSCR-related facts:**

| fact_key | fact_value_num | extractor | created_at |
|----------|---------------|-----------|------------|
| ANNUAL_DEBT_SERVICE | 69480 | classicSpread:debtService:v1 | 2026-05-08 18:57:03 |
| CASH_FLOW_AVAILABLE | 204096.14 | classicSpread:debtService:v1 | 2026-05-08 18:57:04 |
| DSCR | 2.94 | classicSpread:debtService:v1 | 2026-05-08 18:57:04 |
| EXCESS_CASH_FLOW | 134616.14 | classicSpread:debtService:v1 | 2026-05-08 18:57:04 |
| NET_INCOME | 204096.14 | gemini_primary_v1 | 2026-04-01 18:38:58 |
| ORDINARY_BUSINESS_INCOME (2022) | 325912 | gemini_primary_v1 | 2026-04-01 18:39:08 |
| ORDINARY_BUSINESS_INCOME (2023) | 269816 | gemini_primary_v1 | 2026-04-01 18:39:18 |
| ORDINARY_BUSINESS_INCOME (2024) | 328324 | gemini_primary_v1 | 2026-04-01 18:39:31 |

**Key observation:** ALL four FINANCIAL_ANALYSIS facts (ADS, CFA, DSCR, ECF) come from extractor `classicSpread:debtService:v1` — the PRECHECK script. **Zero facts from `computeTotalDebtService` or `persistGlobalCashFlow`.** The canonical write path never produced these facts for Samaritus.

**GLOBAL_CASH_FLOW spread state:**

```
spread_type: GLOBAL_CASH_FLOW
status: ready
error: null
created_at: 2026-04-01 18:38:23
updated_at: 2026-04-03 17:33:30
finished_at: 2026-04-03 17:33:30
```

**GLOBAL_CASH_FLOW rendered rows (DSCR section):**

| key | value | as_of_date | inputs_used |
|-----|-------|------------|-------------|
| EXCESS_CASH_FLOW | **null** | null | CFA + ADS |
| DSCR | **null** | null | CFA + ADS |
| DSCR_STRESSED_300BPS | **null** | null | CFA + ADS_STRESSED |
| GCF_DSCR | **null** | 2023-12-31 | CASH_AVAILABLE / TOTAL_DS |
| GCF_DSCR_STRESSED | **null** | 2023-12-31 | CASH_AVAILABLE / TOTAL_DS_STRESSED |

All DSCR-family rows are null. The PERSONAL section has values (`GCF_PERSONAL_INCOME = -53461`), but PROPERTY and DSCR sections are entirely null.

**Spread job history:** Three SUCCEEDED jobs. Latest on 2026-04-03 17:31:35 included GLOBAL_CASH_FLOW. All succeeded with no errors.

### PIV-3 — Samaritus state matches PRECHECK expectations

Confirmed: DSCR = 2.94, extractor = `classicSpread:debtService:v1`. Unchanged from PRECHECK execution on 2026-05-08.

---

## 2. Question 1 result — Does the GLOBAL_CASH_FLOW spread render at all?

**Outcome: 1C** — Spread exists, status='ready', but DSCR row's value is null.

The spread rendered successfully on 2026-04-03. All 15 rows are present. The PERSONAL section has computed values. But ALL Property and DSCR rows are null because their input facts (FINANCIAL_ANALYSIS.CASH_FLOW_AVAILABLE, FINANCIAL_ANALYSIS.ANNUAL_DEBT_SERVICE) did not exist at render time.

Proceeding to Question 3 (skipping Question 2 — the spread rendered successfully, the question is about missing inputs).

---

## 3. Question 3 result — What fact inputs were missing?

**Outcome: 3B** — Required facts are present NOW but were written AFTER the spread last rendered.

**The critical timing gap:**

| Event | Timestamp | What happened |
|-------|-----------|---------------|
| Raw facts extracted (OBI, NET_INCOME) | 2026-04-01 18:38-39 | Gemini extraction populated raw facts |
| Spread job ran (GLOBAL_CASH_FLOW) | 2026-04-03 17:31-33 | Spread rendered with null DSCR because CFA/ADS facts didn't exist |
| `computeTotalDebtService` ran | 2026-04-03 ~17:33 | **Should have written ADS/DSCR facts — but didn't** (see below) |
| PRECHECK script ran | 2026-05-08 18:57 | Wrote ADS=69480, DSCR=2.94, CFA=204096, ECF=134616 |

**Why `computeTotalDebtService` didn't write facts on 2026-04-03:**

`computeTotalDebtService` (line 96-159 of `computeTotalDebtService.ts`) reads proposed ADS from `deal_structural_pricing.annual_debt_service_est`. The `deal_structural_pricing` row for Samaritus has `computed_at = 2026-04-03` — meaning it was written on the same day the spread job ran. The spread processor calls `computeTotalDebtService` AFTER rendering completes (line 656-677 of `spreadsProcessor.ts`).

Two possible sub-causes:
- **(a)** `computeTotalDebtService` ran but `deal_structural_pricing` didn't have the row yet at that exact moment (race condition within the same processing batch).
- **(b)** `computeTotalDebtService` ran, read the pricing row, but its other prerequisites (NOI fact for DSCR numerator) weren't present in the expected fact_type/fact_key.

Either way: `computeTotalDebtService` ran (the spread processor calls it for every successful spread job) but produced no FINANCIAL_ANALYSIS facts for Samaritus. The spread then rendered with null DSCR inputs and was never re-rendered.

**The re-render gap:** After the PRECHECK wrote FINANCIAL_ANALYSIS facts on 2026-05-08, no spread recompute was triggered. The spread still shows the stale 2026-04-03 rendered_json. If someone triggers a spread recompute for Samaritus now, the DSCR row will pick up the fact via `preferFactOrComputed` and render 2.94.

---

## 4. Not applicable (Question 2 skipped)

Question 2 (why didn't the spread render) was skipped because Q1 outcome was 1C (spread rendered, inputs missing), not 1A/1B.

---

## 5. Root cause statement

The GLOBAL_CASH_FLOW spread doesn't reliably produce DSCR for fresh deals because of a **timing/recompute gap**: the spread renders once during the spread job processing chain, but the FINANCIAL_ANALYSIS facts it needs (CASH_FLOW_AVAILABLE, ANNUAL_DEBT_SERVICE) are either not written by `computeTotalDebtService` at all (because its prerequisites weren't met at processing time), or are written later by a different pathway (the Classic Spread route's embedded aggregator, now `runCashFlowAggregator`). **No mechanism exists to re-render the spread when these facts appear after the initial render.** The spread is a point-in-time snapshot that goes stale when downstream compute writes new facts.

For Samaritus specifically: `computeTotalDebtService` ran on 2026-04-03 but produced zero FINANCIAL_ANALYSIS facts (likely because its own prerequisites — NOI fact in the right format, or `deal_structural_pricing` row — weren't stable at processing time). The PRECHECK wrote the facts 35 days later. The spread was never re-rendered to incorporate them.

---

## 6. Fix options

### Option A — Enqueue spread recompute after `runCashFlowAggregator` writes facts

**What changes:** After `runCashFlowAggregator` writes its 4 FINANCIAL_ANALYSIS facts, call `enqueueSpreadRecompute({ dealId, bankId, spreadTypes: ["GLOBAL_CASH_FLOW"] })`. The GLOBAL_CASH_FLOW spread re-renders, picks up the DSCR fact via `preferFactOrComputed`, and the memo's `computeDscrGlobal` then reads it from the spread (tier 1) instead of falling through to the fact (tier 3).

**Effort:** 2-4 hours. One call site addition in `runCashFlowAggregator.ts` or in the Classic Spread route after the aggregator call.

**Trade-offs:**
- Pro: smallest possible fix. Directly addresses the timing gap.
- Pro: works for any pathway that calls `runCashFlowAggregator` (route today, auto-trigger in B2 later).
- Con: couples the aggregator module to the spread recompute system. The spec said "do not couple aggregator to snapshot" — but this is spread, not snapshot.
- Con: the canonical chain (`computeTotalDebtService` in spreadsProcessor) still doesn't write facts for Samaritus. This option bandaids the workaround, not the canonical chain.

### Option B — Fix `computeTotalDebtService` prerequisites for Samaritus-class deals

**What changes:** Investigate why `computeTotalDebtService` produced zero facts on 2026-04-03. Likely a fact_key/fact_type mismatch between what the function expects as NOI input and what Gemini extraction actually writes. Fix the mismatch so the canonical chain produces ADS/DSCR facts on the first spread processing run.

**Effort:** 1-2 days. Requires reading `computeTotalDebtService` line by line, identifying what it queries for NOI/CFA, and comparing against what Samaritus's extractions actually produced.

**Trade-offs:**
- Pro: fixes the canonical chain. Makes the workaround (`runCashFlowAggregator`) truly redundant for deals where `computeTotalDebtService` runs.
- Pro: spread renders correct DSCR on first processing pass, no re-render needed.
- Con: higher investigation effort. The prerequisite mismatch may be subtle (fact_type mismatch, period format, owner_type, etc.).
- Con: doesn't help deals where `deal_structural_pricing` isn't populated at processing time (the race condition sub-cause).

### Option C — Both A and B (belt and suspenders)

**What changes:** Fix `computeTotalDebtService` prerequisites (Option B) so the canonical chain works on first pass, AND add the spread recompute trigger after `runCashFlowAggregator` (Option A) as defense-in-depth.

**Effort:** 2-3 days total.

**Trade-offs:**
- Pro: most robust. Canonical chain works, workaround is defense-in-depth, spread always reflects latest facts.
- Con: most effort. Two changes to test and verify.

### Option D — Add `runCashFlowAggregator` call to `spreadsProcessor.processSpreadJob`

**What changes:** In `spreadsProcessor.ts`, after `computeTotalDebtService` (line 677), also call `runCashFlowAggregator({ dealId, bankId })`. This ensures the aggregator's facts are written as part of the same processing chain, BEFORE the spread renders. Then the GLOBAL_CASH_FLOW spread picks up the facts on its first render.

**Effort:** 2-4 hours. One call site addition in spreadsProcessor.

**Trade-offs:**
- Pro: eliminates the timing gap entirely — aggregator runs in the same processing batch as the spread.
- Pro: no re-render needed; facts exist when spread renders.
- Con: couples `runCashFlowAggregator` (the workaround) to the canonical processing chain. If the canonical chain's `computeTotalDebtService` is later fixed (Option B), we'd have two fact-writing pathways in the same chain.
- Con: the aggregator's naive DSCR (proposed-only ADS, NCADS fallback) may conflict with `computeTotalDebtService`'s richer DSCR (proposed+existing ADS, NOI-based). Last-write-wins in the spread processor chain means whichever runs second wins.

---

## 7. Open questions

1. **Why did `computeTotalDebtService` produce zero FINANCIAL_ANALYSIS facts for Samaritus on 2026-04-03?** The function ran (the spread processor calls it for every successful job). It either returned `{ ok: false }` (prerequisites not met) or it ran but all its upserts silently failed. The spread processor's try-catch at line 671-677 would have caught any throw but swallowed the error. A follow-up investigation could add instrumentation to capture `computeTotalDebtService`'s return value in the ledger, then re-trigger a spread job on Samaritus to observe the outcome live.

2. **What does `computeTotalDebtService` query for its NOI input?** It writes `DSCR = NOI / totalAds`. Where does it read NOI from? If it reads from a specific fact_key (e.g., `NET_OPERATING_INCOME` in `FINANCIAL_ANALYSIS` fact_type) that Gemini doesn't extract (Gemini writes `NET_INCOME` in `INCOME_STATEMENT` fact_type), that's the prerequisite mismatch.

3. **Is the `deal_structural_pricing` row stable at spread processing time?** The row has `computed_at = 2026-04-03`, same day as the spread job. If the pricing computation and the spread job race, the spread processor's `computeTotalDebtService` call may see an empty pricing table.

4. **Should spread recomputes be triggered automatically when FINANCIAL_ANALYSIS facts change?** Currently they're not — spreads are point-in-time snapshots rendered during job processing. A more general fix (not scoped to this diagnostic) would be an event-driven recompute: any write to `deal_financial_facts` with `fact_type = 'FINANCIAL_ANALYSIS'` enqueues a GLOBAL_CASH_FLOW spread recompute. This is Option A generalized.

---

## Verification — no state mutations

V-11 ✓: `git diff main` shows only this finding document. No production code modified.

V-12 ✓: All PIV-2 SQL queries were SELECT-only. No writes to `deal_financial_facts`, `deal_spreads`, or `deal_spread_jobs`.
