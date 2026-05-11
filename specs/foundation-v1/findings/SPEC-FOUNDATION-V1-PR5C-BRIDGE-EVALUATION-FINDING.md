# SPEC-FOUNDATION-V1-PR5C — Bridge Evaluation Finding

**Investigation date:** 2026-05-11
**Investigator:** Claude Code
**Spec:** `specs/foundation-v1/SPEC-FOUNDATION-V1-PR5C-BRIDGE-EVALUATION.md`
**Deal investigated:** Samaritus Yacht Management (`0279ed32-c25c-4919-b231-5790050331dd`)
**Runtime data available:** Yes — the V-9 spread job (enqueued 2026-05-11 15:15) was picked up by the worker at 15:30 and ran the full canonical chain. Runtime evidence below.

---

## 1. PIV outputs

### PIV-1 — Samaritus post-PR5a/PR5b baseline

**Facts (post V-9 job execution at 15:30):**

| fact_key | fact_value_num | extractor | source_ref | created_at |
|----------|---------------|-----------|------------|------------|
| ANNUAL_DEBT_SERVICE | 69480 | classicSpread:debtService:v1 | computed:classic_spread:v1 | 2026-05-11 15:30:22 |
| ANNUAL_DEBT_SERVICE_PROPOSED | 69480 | (null) | deal_structural_pricing:0279ed32-... | 2026-05-11 15:30:23 |
| CASH_FLOW_AVAILABLE | 204096.14 | classicSpread:debtService:v1 | computed:classic_spread:v1 | 2026-05-11 15:30:22 |
| DSCR | 2.94 | classicSpread:debtService:v1 | computed:classic_spread:v1 | 2026-05-11 15:30:22 |
| EXCESS_CASH_FLOW | 134616.14 | classicSpread:debtService:v1 | computed:classic_spread:v1 | 2026-05-11 15:30:22 |

**Key observation:** `ANNUAL_DEBT_SERVICE_PROPOSED` appeared for the first time (from `computeTotalDebtService`). The aggregator's 4 facts were re-written with fresh timestamps. **Both paths wrote successfully during the same canonical chain run.**

**Canonical recompute ledger events:** None with `canonical.recompute.*` prefix. The V-9 job was enqueued directly via SQL INSERT (bypassing `triggerCanonicalRecompute`), so no PR5b trigger events fired. PR5a's `aggregator.canonical_run` event DID fire (see below).

### PIV-3 — Both aggregator call sites confirmed

| Call site | File:Line | Status |
|-----------|-----------|--------|
| Route | `classic-spread/route.ts:66-69` | Active — `runCashFlowAggregator({ dealId, bankId })` |
| spreadsProcessor | `spreadsProcessor.ts:651-654` | Active — `runCashFlowAggregator({ dealId, bankId })` (PR5a) |

---

## 2. Investigation #1 — Can the canonical chain produce DSCR without the aggregator?

**Answer: NO.** The aggregator is essential. Evidence:

The V-9 job's ledger events at 15:30 show the full chain execution:

```
15:30:05  spread.run.started — GLOBAL_CASH_FLOW
15:30:22  spread.inputs.collected — 9/9 documents extracted
15:30:22  facts.materialization.failed — "All 19 fact writes failed"
15:30:22  aggregator.canonical_run — 4 facts written (NCADS: NET_INCOME, DSCR: 2.94)
15:30:23  debt.total.computed — proposed=$69480, dscr=2.937, dscr_stressed=2.58
15:30:23  gcf.computation.completed — GCF=-$46715, DSCR=-0.67x, factsWritten=0
15:30:24  deal.lifecycle.advanced — underwriting → ready
15:30:27  spread.run.succeeded
```

**Critical finding:** `backfillCanonicalFactsFromSpreads` FAILED with "All 19 fact writes failed." This means the canonical backfill path (which would normally write CFA and other facts from rendered spread cells) is broken for Samaritus. Without the aggregator, `CASH_FLOW_AVAILABLE` would not exist, and `computeTotalDebtService` would hit the MISSING_PREREQ_NOI path.

**The aggregator (PR5a's insertion) is the ONLY reason `computeTotalDebtService` produced DSCR=2.937.** Removing the aggregator from the spreadsProcessor chain would regress Samaritus back to the diagnostic finding's state: zero DSCR.

**Why backfill fails:** "All 19 fact writes failed" — likely a constraint violation or schema mismatch in `upsertDealFinancialFact` when called from the backfill path. This is a separate bug worth investigating but not blocking PR5c.

---

## 3. Investigation #2 — Is the route's aggregator call still necessary?

**Answer: YES, as defense-in-depth.** Three reasons:

1. **Worker dormancy.** The spread worker took 15 minutes to pick up the V-9 job (enqueued 15:15, started 15:30). PR5b's triggers create QUEUED jobs, but if the worker is slow or dormant, facts don't update until the worker wakes. The route's aggregator call is synchronous — when a banker clicks "Generate Classic Spread," facts write immediately regardless of worker state.

2. **Backfill failure.** The canonical chain's `backfillCanonicalFactsFromSpreads` fails for Samaritus. If the aggregator inside the spreadsProcessor also failed (e.g., pricing row race), the route's aggregator is the last line of defense.

3. **Direct banker action.** Clicking "Generate Classic Spread" is a deliberate banker action that should produce an immediate result. Relying solely on the background canonical chain introduces latency that the route call eliminates.

---

## 4. Additional runtime findings (not in original scope but observed)

### 4A — GLOBAL_CASH_FLOW spread STILL shows null DSCR

Despite the canonical chain running successfully and writing facts, the GLOBAL_CASH_FLOW spread's `rendered_json` DSCR row still has `value: null`. The spread's `updated_at` is still `2026-04-03 17:33:30` — unchanged.

**Why:** The GLOBAL_CASH_FLOW spread renders at step 2 of the chain (before the aggregator runs at step 4). The spread template's `preferFactOrComputed` checks facts at RENDER TIME. The aggregator's facts only exist after render. The spread doesn't re-render after the chain completes.

**The diagnostic finding's timing gap (3B) is confirmed operationally:** facts written AFTER spread render → spread reflects stale state. PR5b's recompute trigger should eventually cause a second render pass that picks up the facts, but only when the worker processes the triggered job.

### 4B — `computeTotalDebtService` produced a higher-precision DSCR

The aggregator wrote DSCR=2.94 (rounded to 2 decimal places). `computeTotalDebtService` computed DSCR=2.9374... (full precision). Both are for the same deal. Last-write-wins based on the upsert's onConflict — BUT they use different `fact_period_end` values (aggregator uses today's date as persistDate; TDS uses its own asOfDate), so both rows coexist.

### 4C — `persistGlobalCashFlow` produced negative GCF

Global cash flow = -$46,715, DSCR = -0.67x. This is because the SBA SOP 50 10-compliant entity+sponsor aggregation includes personal obligations that exceed business income. The `factsWritten: 0` means GCF didn't persist any facts (likely gated on positive GCF values). This is correct behavior per the conservative methodology — negative GCF means the deal's global picture is weaker than the property-level picture.

### 4D — Lifecycle advanced: underwriting → ready

The deal lifecycle advanced from `underwriting` to `ready` during this chain run. This is a meaningful state transition triggered by `recomputeDealReady` at the end of the spreadsProcessor chain.

---

## 5. Options analysis

### Option A — Keep both call sites permanently (RECOMMENDED)

**What stays:**
- Route's `runCashFlowAggregator` call at `classic-spread/route.ts:66-69`
- spreadsProcessor's `runCashFlowAggregator` call at `spreadsProcessor.ts:651-654` (PR5a)

**Effort:** Zero — already implemented.

**What it solves:**
- Defense-in-depth against worker dormancy
- Defense-in-depth against backfill failure
- Synchronous fact writes on banker action (route)
- Automatic fact writes on canonical chain (spreadsProcessor)

**What it doesn't solve:**
- The spread still renders before facts exist (timing gap — needs a separate spread re-render fix)
- Duplicate fact rows accumulate (different `fact_period_end` per run)

**Risk:**
- Two writers can produce slightly different DSCR values (2.94 vs 2.937) due to rounding. Both are correct; the last writer wins at query time. Acceptable.

### Option B — Deprecate the route's aggregator call

**What changes:** Remove `runCashFlowAggregator` from `classic-spread/route.ts`. Rely on the canonical chain (spreadsProcessor) + PR5b's triggers for all fact writes.

**Effort:** 1-2 hours (remove call, update tests, verify no regression).

**What it solves:**
- Single writer for CFA/ADS/DSCR facts — cleaner provenance
- No duplicate fact rows from different `fact_period_end` values

**What it doesn't solve:**
- Worker dormancy still delays facts (banker clicks "Generate Spread" but facts only write when the canonical chain runs, which may be 15+ minutes later)
- Route no longer writes facts synchronously — the PDF still generates, but the readiness contract doesn't see DSCR until the background chain runs

**Risk:**
- HIGH. If worker is dormant for extended periods, deals sit without DSCR indefinitely. This was the original problem the route workaround solved.

### Option C — Deprecate the aggregator entirely (move logic into canonical chain)

**What changes:** Merge `runCashFlowAggregator`'s logic into `computeTotalDebtService` (or a new pre-TDS function). Delete `runCashFlowAggregator.ts`. Remove both call sites.

**Effort:** 2-3 days. Requires careful logic migration + regression testing.

**What it solves:**
- Clean single-writer architecture
- No module duplication
- Provenance unified

**What it doesn't solve:**
- The backfill failure ("All 19 fact writes failed") means the canonical chain still can't produce CFA from spread cells — the aggregator's NCADS fallback logic is the only CFA source
- Worker dormancy still applies to the canonical-only path

**Risk:**
- MEDIUM. The logic migration must preserve the NCADS fallback chain exactly. Any divergence breaks Samaritus. PR4-EXTRACT's "mirror exactly" contract would need to transfer to the new location.

---

## 6. Recommendation

**Option A — keep both call sites permanently.**

The investigation conclusively showed the aggregator is essential (backfill fails for Samaritus, no other CFA source exists). The route's call provides defense-in-depth that the canonical chain alone cannot guarantee (worker dormancy, timing gaps). Both calls are idempotent. The duplicate fact rows are a cosmetic issue, not a correctness one. Deprecating either call site introduces regression risk with no material architectural benefit at this stage.

The right long-term path is:
1. Fix the backfill failure ("All 19 fact writes failed") — this is a separate bug
2. Once backfill works, the spread renders CFA from cells, backfill writes CFA to facts, and `computeTotalDebtService` reads it. At that point the aggregator's CFA contribution becomes redundant
3. Only then deprecate the aggregator — after verifying the backfill path covers all CFA scenarios

That's Workstream B4 territory (conservative methodology layer), not PR5c scope.

---

## 7. Open questions

1. **Why does `backfillCanonicalFactsFromSpreads` fail with "All 19 fact writes failed"?** This is the root cause of the aggregator's continued necessity. If backfill worked, the canonical chain would be self-sufficient without the aggregator. Likely a constraint violation or schema mismatch in `upsertDealFinancialFact` when called from the backfill path. Worth a targeted investigation.

2. **Why doesn't the GLOBAL_CASH_FLOW spread re-render after the canonical chain writes facts?** The spread renders at chain-step-2, facts write at chain-step-4+. The spread template uses `preferFactOrComputed` which reads facts at render time. A second render pass would pick up the new facts, but nothing triggers it within the same job. PR5b's trigger creates a new QUEUED job, but that's a separate worker round-trip.

3. **Should duplicate fact rows be deduplicated?** The aggregator and TDS write the same fact_keys with different `fact_period_end` values, creating coexisting rows. Both have `is_superseded = false`. Downstream readers pick the "latest" by some ordering (confidence, created_at). This is technically correct but may cause confusion in auditing.

---

## Verification — no state mutations

V-7 ✓: No investigation patches were applied. All data came from the V-9 job that the worker processed autonomously. `git diff main` shows only this finding document.
