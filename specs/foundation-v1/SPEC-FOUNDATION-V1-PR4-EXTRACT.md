# SPEC-FOUNDATION-V1-PR4-EXTRACT — Cash Flow Aggregator Extraction

**Path:** `specs/foundation-v1/SPEC-FOUNDATION-V1-PR4-EXTRACT.md`
**Status:** Ready for Claude Code (small scope — single session)
**Owner:** Matt (architecture) → Claude Code (implementation)
**Branch:** opens against `feat/foundation-v1-pr4-extract`
**Depends on:** SPEC-FOUNDATION-V1 PR1, PR2, PR4-PRECHECK all merged. Verified on `main` as of `ce262f37`.
**Governs under:** SPEC-BANKER-HOLY-SHIT-V1 Workstream B1
**Replaces in scope:** the "Aggregator core" portion of `SPEC-FOUNDATION-V1-PR4-cash-flow-aggregator.md`. The methodology / per-tenant-policy / submission-gate sub-PRs from that spec are deferred to Workstream B4/B5 of the Holy Shit Spec.

---

## Problem in one paragraph

The PRECHECK script we ran on Samaritus today (`scripts/foundation-pr4-precheck-compute.ts`) verified that the embedded compute pathway in `src/app/api/deals/[dealId]/classic-spread/route.ts` (lines ~58–155) correctly produces `ANNUAL_DEBT_SERVICE`, `DSCR`, `CASH_FLOW_AVAILABLE`, and `EXCESS_CASH_FLOW` from `deal_structural_pricing.annual_debt_service_est` plus the latest-period NCADS fact (EBITDA → ORDINARY_BUSINESS_INCOME → NET_INCOME fallback). For Samaritus this produced DSCR = 2.94 with full readiness gate clear. **But the compute only fires when a banker GETs the Classic Spread PDF route.** A banker who hasn't clicked "Generate Classic Spread" sees a deal with empty DSCR even when all the inputs are present in `deal_financial_facts`. This is the single biggest UX gap in the auto-compute contract.

## Solution in one paragraph

Extract the embedded compute pathway from `classic-spread/route.ts` into a standalone module `src/lib/financialFacts/runCashFlowAggregator.ts`. Mirror the route's logic exactly — same fact-key fallback chain, same period selection, same sentinel UUID + sentinel date, same provenance shape, same `onConflict` columns. Skip the snapshot rebuild (separate concern). Export a pure function `runCashFlowAggregator({ dealId, bankId })` returning a structured result. Modify the route to call the standalone module instead of having the logic inline — preserves backwards compatibility, reduces duplication, and prepares the seam for B2's automatic triggering. **No behavior change for end users.** A banker GET-ing the Classic Spread route after this lands sees identical output. The win is that the module is now callable from anywhere, including the fact materialization pipeline (B2 follow-up).

---

## PIV — pre-implementation verification

Before writing code, Claude Code must confirm the following on `main`. Paste output into the AAR.

### PIV-1. Confirm the embedded compute is still where the spec expects it

```bash
grep -n "annual_debt_service_est\|EBITDA\|ORDINARY_BUSINESS_INCOME\|NET_INCOME\|classicSpread:debtService:v1" \
  src/app/api/deals/\[dealId\]/classic-spread/route.ts
```

**Expected:** matches inside the `try { ... } catch (bridgeErr ...)` block in the GET handler, between approximately line 58 and line 155. If the route has been refactored, **STOP** and surface the change to Matt — extraction must mirror whatever logic is actually live.

### PIV-2. Confirm the PRECHECK script exists and matches the embedded logic

```bash
ls scripts/foundation-pr4-precheck-compute.ts
head -60 scripts/foundation-pr4-precheck-compute.ts
```

**Expected:** file exists. Header comment names it as the precheck verification script, not the production aggregator. Verifies the logic we're extracting is already proven correct against Samaritus.

### PIV-3. Confirm Samaritus deal state is unchanged from PRECHECK execution

Run via `the buddy supa mcp:execute_sql`:

```sql
SELECT
  fact_key, fact_value_num, provenance->>'extractor' AS extractor
FROM deal_financial_facts
WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd'
  AND fact_type = 'FINANCIAL_ANALYSIS'
  AND is_superseded = false
  AND fact_key IN ('ANNUAL_DEBT_SERVICE', 'DSCR', 'CASH_FLOW_AVAILABLE', 'EXCESS_CASH_FLOW')
ORDER BY fact_key;
```

**Expected:** four rows. `ANNUAL_DEBT_SERVICE = 69480`, `DSCR = 2.94`, `CASH_FLOW_AVAILABLE = 204096.14`, `EXCESS_CASH_FLOW = 134616.14`, all with extractor `classicSpread:debtService:v1`. If output diverges, surface the change.

### PIV-4. Confirm `supabaseAdmin` import path is current

```bash
grep -n "from \"@/lib/supabase/admin\"" src/app/api/deals/\[dealId\]/classic-spread/route.ts
```

**Expected:** the route uses dynamic import (`(await import("@/lib/supabase/admin")).supabaseAdmin()`). The new aggregator can use the static import `import { supabaseAdmin } from "@/lib/supabase/admin"` since it's not in a route handler with cold-start sensitivity.

---

## Scope

### In scope (this PR)

1. **New module: `src/lib/financialFacts/runCashFlowAggregator.ts`** that exports a pure async function:

```typescript
export type RunCashFlowAggregatorResult =
  | {
      ok: true;
      dealId: string;
      bankId: string;
      proposedAds: number;
      ncads: number | null;
      ncadsSource: "EBITDA" | "ORDINARY_BUSINESS_INCOME" | "NET_INCOME" | null;
      latestPeriod: string;
      dscr: number | null;
      factsWritten: number;
      factsAttempted: number;
    }
  | {
      ok: false;
      reason:
        | "no_pricing_row"
        | "invalid_proposed_ads"
        | "no_ncads_candidates"
        | "internal_error";
      detail?: string;
    };

export async function runCashFlowAggregator(args: {
  dealId: string;
  bankId: string;
}): Promise<RunCashFlowAggregatorResult>;
```

2. **The module mirrors the route's logic exactly.** Same fact-key fallback chain (EBITDA → ORDINARY_BUSINESS_INCOME → NET_INCOME). Same period selection (first row's `fact_period_end` after `ORDER BY fact_period_end DESC`). Same filtering (`is_superseded = false`, `resolution_status != 'rejected'`, `fact_value_num NOT NULL`, `fact_key IN (...)`, `LIMIT 10`). Same sentinel UUID `00000000-0000-0000-0000-000000000000` and sentinel date `1900-01-01`. Same provenance shape (`{ source_type: "STRUCTURAL", source_ref: "computed:classic_spread:v1", as_of_date: persistDate, extractor: "classicSpread:debtService:v1" }`). Same `onConflict` columns. Same fact filtering (skip if `fact_value_num` is null or non-finite).

3. **The route is refactored to call the module.** The embedded `try { ... } catch (bridgeErr ...)` block in `src/app/api/deals/[dealId]/classic-spread/route.ts` (lines ~58–155) is replaced with a single call to `runCashFlowAggregator({ dealId, bankId })`. The snapshot rebuild that follows the embedded compute (lines that call `buildDealFinancialSnapshotForBank` + `persistFinancialSnapshot`) **stays in the route** — it is not part of the aggregator's responsibility. Wrap the aggregator call in a try/catch and log warnings on failure (preserve "non-fatal: PDF always returns" behavior).

4. **Unit tests for the new module.** At minimum:
   - Returns `ok: false, reason: "no_pricing_row"` when `deal_structural_pricing` has no row for the deal.
   - Returns `ok: false, reason: "invalid_proposed_ads"` when `annual_debt_service_est` is null, zero, or negative.
   - Returns `ok: false, reason: "no_ncads_candidates"` when no qualifying facts exist.
   - With EBITDA fact present → `ncadsSource: "EBITDA"`, computed DSCR matches expected.
   - With only NET_INCOME fact present (no EBITDA, no OBI) → `ncadsSource: "NET_INCOME"`.
   - Idempotency: running twice produces identical fact rows (no duplicate writes — the upsert's `onConflict` handles this).

5. **Snapshot test against Samaritus state.** A test that runs `runCashFlowAggregator` against a fixture mirroring Samaritus's current state and asserts the output: `dscr: 2.94`, `proposedAds: 69480`, `ncadsSource: "NET_INCOME"`, `ncads: 204096.14`, `factsWritten: 4`. This is the proof the extraction preserved correctness.

### Out of scope (deferred to later PRs)

- **Automatic triggering** — that's B2 (`SPEC-FOUNDATION-V1-PR4-AUTOTRIGGER`, not yet drafted). B1 only extracts; the route is still the only caller.
- **Conservative methodology layer** (Form 1084, worst-of-three living expense, pro-rata affiliates, owner W-2 conditional add-back) — that's B4.
- **Stress A/B/C scenarios** — B4.
- **Submission gate threshold update** — B5.
- **Per-tenant policy** — B4.
- **Manual recompute endpoint** — B2.
- **Snapshot persistence** — stays in the route. Not part of the aggregator's contract.
- **Any change to readiness contract** — `evaluateMemoReadinessContract` is unchanged.
- **Any change to `deal_structural_pricing` schema or population logic.**

### Hard non-goals

- **Do not "improve" the logic.** Mirror exactly. The PRECHECK proved the route's logic correct on Samaritus today; B1 is a refactor, not a rewrite. If the implementer notices a bug in the route's logic mid-extraction, file it as a follow-up — do not fix it inside B1.
- **Do not introduce a new fact_key or change provenance shape.** The aggregator writes the same four facts the route already writes, with identical metadata.
- **Do not couple the aggregator to the snapshot rebuild.** Aggregator writes facts. Snapshot is downstream. Keep them separate.
- **Do not change the route's preflight gate or PDF rendering path.** B1 only touches the embedded `try { ... }` block, not the rest of the GET handler.

---

## File-by-file change plan

### New files

| Path | Purpose | Approx LOC |
|------|---------|------------|
| `src/lib/financialFacts/runCashFlowAggregator.ts` | Standalone aggregator module | 180 |
| `src/lib/financialFacts/__tests__/runCashFlowAggregator.test.ts` | Unit tests (5 scenarios + idempotency + Samaritus fixture) | 300 |

### Modified files

| Path | Change | Risk |
|------|--------|------|
| `src/app/api/deals/[dealId]/classic-spread/route.ts` | Replace embedded compute (lines ~58–155) with call to `runCashFlowAggregator`. Snapshot rebuild stays. Preserve non-fatal try/catch wrap. | Medium — touches a heavily-used route, but behavior is identical |

### No new files needed for routing, schema, or migrations.

---

## Tests

### Unit tests — `runCashFlowAggregator.test.ts`

1. **No pricing row** → `{ ok: false, reason: "no_pricing_row" }`. Mock Supabase to return `{ data: null }` for `deal_structural_pricing`.
2. **Invalid `proposedAds`** (null, 0, negative) → `{ ok: false, reason: "invalid_proposed_ads", detail: "..." }`. Three subtests, one per invalid value.
3. **No NCADS candidates** → `{ ok: false, reason: "no_ncads_candidates" }`. Mock fact rows to return empty array.
4. **EBITDA wins fallback** → `ncadsSource: "EBITDA"`, computed DSCR = `Math.round((ebitda / ads) * 100) / 100`.
5. **OBI wins fallback** (no EBITDA) → `ncadsSource: "ORDINARY_BUSINESS_INCOME"`.
6. **NET_INCOME wins fallback** (no EBITDA, no OBI) → `ncadsSource: "NET_INCOME"`.
7. **Period selection** → with two periods present (e.g., 2024-12-31 and 2025-12-31), picks the latest one. NCADS comes from facts whose `fact_period_end` matches `latestPeriod`.
8. **Negative NCADS** → DSCR computed correctly, but `CASH_FLOW_AVAILABLE` and `EXCESS_CASH_FLOW` are NOT written (per the route's `Number(ncads) > 0` filter). `factsWritten === 2`, not 4.
9. **Non-finite DSCR** (e.g., NCADS = 0) → DSCR fact is filtered out by `Number.isFinite(f.value)` check. `factsWritten` reflects only finite facts.
10. **Idempotency** → running twice writes the same four facts; upsert `onConflict` deduplicates. Second run reports `factsWritten: 4` but no new rows in DB (verified via mock spy on upsert).

### Fixture test — Samaritus snapshot

11. **Samaritus fixture** → mock `deal_structural_pricing` to return `{ annual_debt_service_est: 69480 }`. Mock `deal_financial_facts` to return the NET_INCOME row at `fact_period_end: 2025-12-31` with value `204096.14`. Run `runCashFlowAggregator({ dealId: "0279ed32-...", bankId: "2cd15251-..." })`. Assert result: `{ ok: true, proposedAds: 69480, ncads: 204096.14, ncadsSource: "NET_INCOME", latestPeriod: "2025-12-31", dscr: 2.94, factsWritten: 4, factsAttempted: 4 }`.

### Route integration test (modified file)

12. **Route still produces PDF** → existing route test (if present) should pass without modification. The behavior contract is preserved.
13. **Route calls aggregator** → spy on `runCashFlowAggregator` import; assert called once per GET with the correct dealId/bankId.
14. **Aggregator failure is non-fatal** → mock `runCashFlowAggregator` to throw. PDF response is still returned. Warning logged.

---

## V-N verification checklist

V-1. ☐ All PIV outputs pasted into AAR.
V-2. ☐ `src/lib/financialFacts/runCashFlowAggregator.ts` exists and exports `runCashFlowAggregator`. Read via `github_read_file`.
V-3. ☐ Module logic matches the route's logic line-for-line. Diff the extracted module against the route's original embedded block — only differences should be: import statements, function signature, return shape, removal of snapshot persistence.
V-4. ☐ `src/app/api/deals/[dealId]/classic-spread/route.ts` no longer contains the embedded compute. Grep for `EBITDA\|ORDINARY_BUSINESS_INCOME\|NET_INCOME` in the file — should match only at the top-level imports if any, not inside the GET handler body.
V-5. ☐ Snapshot rebuild remains in the route after the aggregator call. Grep for `buildDealFinancialSnapshotForBank` in the file — should be present.
V-6. ☐ Run `pnpm test src/lib/financialFacts/__tests__/runCashFlowAggregator.test.ts` — all 11 unit + fixture tests pass.
V-7. ☐ `pnpm tsc --noEmit` passes clean.
V-8. ☐ Hit the Classic Spread route against Samaritus: `GET /deals/0279ed32-c25c-4919-b231-5790050331dd/classic-spread` (or via browser). Confirm PDF returns. Confirm via SQL that the four FINANCIAL_ANALYSIS facts still exist with extractor `classicSpread:debtService:v1` and unchanged values.
V-9. ☐ `pnpm test` clean across the whole suite. No SPEC-01..13 regressions.

---

## Risk register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Route refactor introduces silent behavior change | V-8 explicitly verifies the four facts post-extraction match the pre-extraction values for Samaritus. PRECHECK already established the baseline. |
| 2 | Aggregator import path collision with existing `cashFlowAggregator/` directory mentioned in the older PR4 spec | The older spec's `src/lib/financialFacts/cashFlowAggregator/` directory does NOT exist on `main` (the older PR4 spec was never implemented). The new module is a single file at `src/lib/financialFacts/runCashFlowAggregator.ts`. No collision. |
| 3 | Snapshot rebuild order changes | Aggregator runs first, then snapshot rebuild — same order as the original embedded code. No change. |
| 4 | Route response timing | Aggregator is awaited (Vercel kills background promises on response send, same as today). No new latency introduced. |
| 5 | Test coverage gaps in mocking Supabase | Use existing test patterns from `src/lib/creditMemo/canonical/__tests__/` if available. If not, file a small helper `mockSupabaseAdmin` for use in this PR's tests and any future ones. |
| 6 | Future maintainers don't realize the aggregator mirrors the route exactly | Header comment in the new module explicitly states: "This aggregator mirrors the embedded compute pathway from `src/app/api/deals/[dealId]/classic-spread/route.ts` as it stood at commit `ce262f37`. Any logic change here MUST be paired with a change to the route, or the route must be changed to call this module exclusively." |

---

## Hand-off commit message

```
feat(financialFacts): extract cash flow aggregator (SPEC-FOUNDATION-V1 PR4 EXTRACT)

Extracts the embedded compute pathway from
src/app/api/deals/[dealId]/classic-spread/route.ts into a standalone
runCashFlowAggregator module. Mirrors the route's logic exactly —
same fact-key fallback chain (EBITDA → OBI → NET_INCOME), same period
selection, same sentinel UUID + sentinel date, same provenance shape,
same onConflict columns. Snapshot rebuild stays in the route.

PRECHECK proved the logic correct on Samaritus today (DSCR 2.94, four
facts written cleanly). This PR is a behavior-preserving refactor that
prepares the seam for B2 (automatic triggering after fact
materialization) without changing what gets written.

No new fact_keys. No provenance changes. No readiness contract changes.
No methodology layer (deferred to B4).

Spec: specs/foundation-v1/SPEC-FOUNDATION-V1-PR4-EXTRACT.md
Governs under: SPEC-BANKER-HOLY-SHIT-V1 Workstream B1
```

---

## Addendum for Claude Code

**Critical reminders:**

1. **Mirror, don't optimize.** The PRECHECK script we ran today is the gold standard for behavioral parity. If the new module diverges from the route's logic in any way other than necessary refactoring, that's a bug, not an improvement. File any optimization ideas as follow-ups.

2. **The snapshot rebuild stays in the route.** The Holy Shit Spec explicitly separated aggregator concerns from snapshot concerns. The aggregator writes facts. The snapshot is rebuilt downstream from facts. Coupling them in the new module would defeat the seam B2 needs.

3. **Header comment is load-bearing.** The header comment in `runCashFlowAggregator.ts` should explicitly call out the parity contract with the route. Any future contributor reading the module should understand why the logic is shaped this way and what the downstream consumer (route, then in B2 also the materialization pipeline) expects.

4. **Don't add a manual recompute endpoint in this PR.** That's B2 work. B1 stops at "extract module + route calls module + tests pass."

5. **Samaritus is the canonical reference.** The PRECHECK script's expected output is the contract. After V-8 verifies, Samaritus's `deal_financial_facts` should look identical pre- and post-extraction.

6. **The older `SPEC-FOUNDATION-V1-PR4-cash-flow-aggregator.md` is preserved for historical reference but is NOT what's being implemented.** That spec described the maximalist methodology layer (Form 1084, worst-of-three living expense, etc.), which is now Workstream B4 of the Holy Shit Spec. B1 implements only the EXTRACTION sub-scope.

7. **Per-tenant policy is out of scope.** No `bank_underwriting_policies` table in this PR. No tenant policy reads. The aggregator computes the same DSCR for every tenant, identical to today's route behavior. Tenant policy is B4.

8. **AAR requirements:** include the V-N table with each item marked ✓ or ✗. For ✗ items, include the file path + reason. Include the Samaritus pre/post fact comparison SQL output. Include `pnpm tsc --noEmit` and `pnpm test` outputs.

9. **The Holy Shit Spec governs.** When any of the constraints in this spec conflict with the older PR4 spec, this spec wins. The older spec is reference, not contract.

10. **Estimated effort: half a day.** If the implementation is taking longer than that, surface to Matt — likely scope drift. Either the route's current state diverges from the PRECHECK baseline (in which case PIV should have caught it and stopped before implementation) or the test infrastructure for `cashFlowAggregator` mocking is heavier than expected (in which case file as follow-up and ship the module + route refactor without full test coverage in this PR, with a separate test PR following).
