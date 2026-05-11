# SPEC-FOUNDATION-V1-PR5D — Observability for Canonical Recompute

**Path:** `specs/foundation-v1/SPEC-FOUNDATION-V1-PR5D-OBSERVABILITY.md`
**Status:** Ready for Claude Code (small scope — 0.5 to 1 day)
**Owner:** Matt (architecture) → Claude Code (implementation)
**Branch:** opens against `feat/foundation-v1-pr5d-observability`
**Depends on:** PR5a + PR5b + PR5c merged
**Sequence position:** 4 of 4

---

## Problem in one paragraph

PR5b emitted `canonical.recompute.triggered` and `canonical.recompute.waiting_on_facts` ledger events for trigger-time observability. But the canonical chain has more places where things can go invisibly wrong: the aggregator's `MISSING_PREREQ_NOI` event was added in PR5a but doesn't have a clear "this is the canonical chain reporting" tag; `computeTotalDebtService`'s success/failure isn't tied to a canonical recompute event; `persistGlobalCashFlow`'s output isn't reflected in the canonical event stream. An operator reading `deal_pipeline_ledger` for a deal can see what was *triggered* but not *what each canonical step produced*. PR5d adds end-to-end ledger telemetry so the canonical chain is fully traceable from trigger → aggregator → computeTotalDebtService → persistGlobalCashFlow → spread render.

## Solution in one paragraph

Add a structured `canonical.recompute.*` ledger event at each step of the canonical chain: `canonical.recompute.aggregator.completed` (with facts written, NCADS source), `canonical.recompute.compute_total_debt_service.completed` (with proposed/existing/total/dscr values), `canonical.recompute.gcf.completed` (with global DSCR + warnings), `canonical.recompute.spread_rendered` (with spread status + DSCR row value). Each event carries the originating trigger reason from PR5b so operators can trace a full chain from trigger to render. Events are non-fatal — instrumentation only, never blocks the chain.

## PIV — pre-implementation verification

### PIV-1. Confirm existing ledger event shapes

```bash
grep -rn 'logLedgerEvent\|writeEvent' src/lib/jobs/processors/spreadsProcessor.ts
grep -rn 'logLedgerEvent\|writeEvent' src/lib/structuralPricing/computeTotalDebtService.ts
grep -rn 'logLedgerEvent\|writeEvent' src/lib/financialIntelligence/persistGlobalCashFlow.ts
```

Document the existing ledger usage in each file. PR5d adds events; doesn't replace existing ones. Confirm the canonical helper (most likely `writeEvent` from `src/lib/ledger/writeEvent.ts`).

### PIV-2. Confirm `triggerCanonicalRecompute` carries reason through the chain

The reason needs to flow from PR5b's trigger through to PR5d's downstream events. Determine the propagation mechanism: either pass `reason` through the spread job's `meta` field (already used for `run_id` and `owner_type` per `enqueueSpreadRecompute.ts`), or read it from the most recent `canonical.recompute.triggered` event for the deal at the start of `processSpreadJob`.

**Recommended:** add `triggerReason` to spread job `meta`. PR5b populates it via `enqueueSpreadRecompute({ ..., meta: { triggerReason: args.reason } })`. PR5d's events read it from `deal_spread_jobs.meta.triggerReason`.

This requires a small modification to PR5b — surface it in PIV.

### PIV-3. Confirm `deal_pipeline_ledger` event shape supports new `event_key` values

```bash
grep -rn 'deal_pipeline_ledger' src/lib/ledger/ | head -20
```

Confirm there's no enum constraint on `event_key` (free-form text) and that `meta` is a `jsonb` column accepting arbitrary structured data. If a constraint exists, surface to Matt — we may need a migration.

### PIV-4. Sample current Samaritus event stream as baseline

Run via `the buddy supa mcp:execute_sql`:

```sql
SELECT event_key, ui_state, ui_message,
       meta->>'triggerReason' AS trigger_reason,
       created_at
FROM deal_pipeline_ledger
WHERE deal_id = '0279ed32-c25c-4919-b231-5790050331dd'
  AND (event_key LIKE 'canonical.recompute.%' OR event_key LIKE 'spread.%')
ORDER BY created_at DESC
LIMIT 20;
```

**Expected after PR5a + PR5b merged:** `canonical.recompute.triggered` events visible. PR5d's new events absent.

---

## Scope

### In scope (this PR)

1. **Modify `triggerCanonicalRecompute`** to pass `reason` through to `enqueueSpreadRecompute`'s `meta` field as `triggerReason`. Backward-compatible — `meta` field already exists in `enqueueSpreadRecompute`'s signature. Small modification to PR5b's deliverable.

2. **Add ledger events at each canonical step.** Four new event types:

   **(a) In spreadsProcessor, immediately after `runCashFlowAggregator` call inside the chain:**
   ```typescript
   void writeEvent({
     dealId,
     kind: "canonical.recompute.aggregator.completed",
     scope: "canonical_recompute",
     action: aggregatorResult.ok ? "completed" : "skipped",
     meta: {
       triggerReason: jobMetaTriggerReason ?? "unknown",
       ok: aggregatorResult.ok,
       factsWritten: aggregatorResult.ok ? aggregatorResult.factsWritten : 0,
       factsAttempted: aggregatorResult.ok ? aggregatorResult.factsAttempted : 0,
       ncadsSource: aggregatorResult.ok ? aggregatorResult.ncadsSource : null,
       dscr: aggregatorResult.ok ? aggregatorResult.dscr : null,
       reason: aggregatorResult.ok ? null : aggregatorResult.reason,
     },
   }).catch(() => {});
   ```

   **(b) In `computeTotalDebtService`, at function exit (before return):**
   ```typescript
   const triggerReason = await readTriggerReasonFromMostRecentJob(dealId, bankId);
   void writeEvent({
     dealId,
     kind: "canonical.recompute.compute_total_debt_service.completed",
     scope: "canonical_recompute",
     action: result.data.dscr !== null ? "completed" : "completed_partial",
     meta: {
       triggerReason: triggerReason ?? "unknown",
       proposed: result.data.proposed,
       existing: result.data.existing,
       total: result.data.total,
       dscr: result.data.dscr,
       dscrStressed: result.data.dscrStressed,
       missingPrereqNoi: result.data.dscr === null,
     },
   }).catch(() => {});
   ```

   **(c) In `persistGlobalCashFlow`, at function exit (before return):**
   ```typescript
   const triggerReason = await readTriggerReasonFromMostRecentJob(dealId, bankId);
   void writeEvent({
     dealId,
     kind: "canonical.recompute.gcf.completed",
     scope: "canonical_recompute",
     action: gcfResult.result.globalDscr !== null ? "completed" : "completed_partial",
     meta: {
       triggerReason: triggerReason ?? "unknown",
       globalCashFlow: gcfResult.result.globalCashFlow,
       globalDscr: gcfResult.result.globalDscr,
       factsWritten,
       warningCount: gcfResult.notes?.length ?? 0,
       warnings: gcfResult.notes ?? [],
     },
   }).catch(() => {});
   ```

   **(d) In spreadsProcessor, after spread render completes for GLOBAL_CASH_FLOW:**
   ```typescript
   const dscrRow = renderedSpread.rows?.find(r => r.key === "DSCR");
   const dscrRowValue = dscrRow?.values?.[0]?.value ?? null;
   void writeEvent({
     dealId,
     kind: "canonical.recompute.spread_rendered",
     scope: "canonical_recompute",
     action: dscrRowValue !== null ? "completed" : "completed_partial",
     meta: {
       triggerReason: jobMetaTriggerReason ?? "unknown",
       spreadType: "GLOBAL_CASH_FLOW",
       spreadStatus: renderedSpread.status,
       dscrRowValue,
       hasGlobalDscrRow: !!renderedSpread.rows?.find(r => r.key === "GCF_DSCR"),
     },
   }).catch(() => {});
   ```

3. **New helper `readTriggerReasonFromMostRecentJob`** in `src/lib/financialFacts/readTriggerReason.ts`:
   ```typescript
   export async function readTriggerReasonFromMostRecentJob(
     dealId: string,
     bankId: string,
   ): Promise<string | null> {
     try {
       const sb = supabaseAdmin();
       const { data } = await (sb as any)
         .from("deal_spread_jobs")
         .select("meta")
         .eq("deal_id", dealId)
         .eq("bank_id", bankId)
         .order("updated_at", { ascending: false })
         .limit(1)
         .maybeSingle();
       return (data?.meta?.triggerReason as string) ?? null;
     } catch {
       return null;
     }
   }
   ```

4. **Unit tests** (7 cases) + **integration test** (1 case) verifying event shapes, trigger reason propagation, and null-handling.

5. **Manual Samaritus verification** — trigger a canonical recompute, query for five sequential events with consistent trigger reason.

### Out of scope

- Ledger query views or dashboards (downstream work)
- Severity/error_code fields on events (existing shape sufficient)
- Rate-limiting event emission (one per chain run, not high-volume)
- Auto-emit from non-canonical-chain call paths

### Hard non-goals

- Do not change canonical compute logic — instrumentation only
- Do not block the chain on event emission failure — all fire-and-forget
- Do not introduce a new event store — use existing `writeEvent` + `deal_pipeline_ledger`
- Do not modify existing ledger events — add-only

---

## File-by-file change plan

### New files

| Path | Purpose | Approx LOC |
|------|---------|------------|
| `src/lib/financialFacts/readTriggerReason.ts` | Helper to read `triggerReason` from most recent spread job meta | 30 |
| `src/lib/financialFacts/__tests__/canonical-observability.test.ts` | Unit + integration tests for the four event types | 200 |

### Modified files

| Path | Change | Risk |
|------|--------|------|
| `src/lib/financialFacts/triggerCanonicalRecompute.ts` | Pass `reason` through `enqueueSpreadRecompute` `meta.triggerReason` | Low — additive on existing `meta` field |
| `src/lib/jobs/processors/spreadsProcessor.ts` | Emit events (a) and (d) | Low — additive instrumentation |
| `src/lib/structuralPricing/computeTotalDebtService.ts` | Emit event (b) | Low — additive |
| `src/lib/financialIntelligence/persistGlobalCashFlow.ts` | Emit event (c) | Low — additive |

---

## V-N verification checklist

V-1. ☐ All four PIV outputs captured in AAR.
V-2. ☐ `triggerCanonicalRecompute` passes `reason` through `meta.triggerReason`.
V-3. ☐ `readTriggerReasonFromMostRecentJob` helper exists and handles missing-meta gracefully.
V-4. ☐ Four new event types emit at the right call sites.
V-5. ☐ All seven unit tests pass.
V-6. ☐ Integration test (#8) passes.
V-7. ☐ `pnpm tsc --noEmit` clean.
V-8. ☐ `pnpm test` clean across whole suite.
V-9. ☐ Event emission is fire-and-forget at every call site (`void writeEvent` + `.catch(() => {})`).
V-10. ☐ Existing ledger events not removed or modified — only new events added.
V-11. ☐ Samaritus manual verification: five events visible with consistent `triggerReason`.

---

## Risk register

| # | Risk | Mitigation |
|---|------|------------|
| 1 | Event emission failures cascade and block the canonical chain | Fire-and-forget `.catch(() => {})` at every emission. V-9 verifies. |
| 2 | `triggerReason` propagation breaks existing spread job processing | `meta.triggerReason` is additive; existing `meta` consumers unchanged. |
| 3 | Ledger events become noisy | Operators filter on `event_key LIKE 'canonical.recompute.%'`. |
| 4 | `readTriggerReasonFromMostRecentJob` creates query dependency | Helper isolates dependency. Falls back to `"unknown"` on failure. |
| 5 | Integration test mocking is heavy | Escape hatch: ship with unit tests only, file integration follow-up. |
| 6 | Stale data from `readTriggerReasonFromMostRecentJob` | Acceptable — worst case tags event with previous trigger's reason. |
| 7 | DSCR row extraction depends on exact key `"DSCR"` | Per template, key is exactly `"DSCR"`. Test #7 covers null case. |

---

## Hand-off commit message

```
feat(financialFacts): canonical recompute observability (SPEC-FOUNDATION-V1 PR5d)

Adds end-to-end ledger telemetry for the canonical compute chain. Each step
(aggregator, computeTotalDebtService, persistGlobalCashFlow, spread render)
now emits a structured canonical.recompute.* event carrying the originating
trigger reason.

Completes the PR5 arc (PR5a: prereq fix, PR5b: recompute triggers,
PR5c: bridge evaluation, PR5d: observability).

Spec: specs/foundation-v1/SPEC-FOUNDATION-V1-PR5D-OBSERVABILITY.md
Governs under: SPEC-BANKER-HOLY-SHIT-V1 Workstream B
```
