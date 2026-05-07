# SPEC-FLOW-V1 PR3 — Lifecycle Advancement on Banker Submission

**Path:** specs/banker-flow-v1/SPEC-FLOW-V1-PR3-lifecycle-advancement.md
**Status:** Ready for Claude Code
**Owner:** Matt (architecture) → Claude Code (implementation)
**Branch:** main, PR opens against `feat/spec-flow-v1-pr3-lifecycle-advancement`
**Depends on:** SPEC-FLOW-V1 PR1 (`2647e1a4`), PR2 (`ee569aa5`), SPEC-13.5 closed
**Blocks:** SPEC-FLOW-V1 PR4 (spread janitor) is independent; PR5 (deal-creation guidance) is independent. PR3 unblocks downstream observability work.

## Problem in one paragraph

When a banker submits a credit memo via `submitCreditMemoToUnderwriting`, the function correctly inserts a row to `credit_memo_snapshots` with `status='banker_submitted'`, then calls `scheduleReadinessRefresh` (fire-and-forget, derives lifecycle state from data). It does NOT call `advanceDealLifecycle()`, which means the canonical lifecycle event `deal.lifecycle.advanced` is never written to `audit_ledger` for the submission transition, and the underlying deal stage is never advanced via the canonical helper. Consequences: (1) the audit ledger has no record of "banker certified this memo at this time" as a lifecycle event — only as an opaque snapshot insert; (2) downstream readers that watch `deal.lifecycle.advanced` for stage transitions never see the submission; (3) the `scheduleReadinessRefresh` derivation may or may not flip the deal to a new stage depending on what `deriveLifecycleState` reads from data, but no explicit transition is recorded; (4) the `from`/`to` pair specifying which stage the submission moved the deal into is lost. SPEC-FLOW-V1 PR3 fixes this by having the submission helper call `advanceDealLifecycle` after a successful snapshot insert, with the `submission_completed` reason and `banker` actor type.

## Solution in one paragraph

Add a call to `advanceDealLifecycle()` in `submitCreditMemoToUnderwriting` immediately after the snapshot row is successfully inserted. The call passes the dealId and an `ActorContext` with `type: "banker"` and `id: args.bankerId`. The lifecycle helper handles transition-rule checks, blocker evaluation, ledger event emission, and underlying stage sync. Three nuances: (1) the submission transition is `underwrite_in_progress → committee_ready` per the lifecycle model's `ALLOWED_STAGE_TRANSITIONS`, but the deal may be at `underwrite_ready` or earlier when submitted (the readiness contract is stricter than the lifecycle's intermediate stages), so the call needs `forceAdvanceLifecycle` for the intermediate hop or two sequential `advanceDealLifecycle` calls — investigate and choose; (2) `advanceDealLifecycle` already calls `scheduleReadinessRefresh`-equivalent logic via `deriveLifecycleState`, so the existing `scheduleReadinessRefresh` call in the submission helper becomes redundant — remove it; (3) lifecycle advancement failures should NOT roll back the snapshot insert (the snapshot is the canonical artifact; lifecycle is observability). On lifecycle failure, log a warning, write a `deal.lifecycle.advance_failed` audit event, return success. Two PRs of work: one for the integration + tests, one for the historical backfill of past `banker_submitted` snapshots that exist without lifecycle events (currently zero, per PIV-2 below — so the backfill PR is empty and gets dropped).

## PIV — pre-implementation verification (mandatory)

Run each PIV in order. Paste actual output into the AAR.

### PIV-1. Confirm `submitCreditMemoToUnderwriting` does NOT call `advanceDealLifecycle`

```bash
grep -n "advanceDealLifecycle\|forceAdvanceLifecycle\|deal.lifecycle.advanced\|lifecycle_advanced" \
  src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts
```

**Expected:** zero hits. Confirms Fix #2 is the missing call, not a misconfigured one.

### PIV-2. Confirm zero historical `deal.lifecycle.advanced` events for submission transitions

Run via Supabase MCP:

```sql
SELECT COUNT(*) AS submission_lifecycle_events
FROM audit_ledger
WHERE kind = 'deal.lifecycle.advanced'
  AND (input_json->'input'->>'reason' = 'submission_completed'
       OR input_json->'input'->>'reason' LIKE '%banker_submitted%');
```

**Expected:** 0. If non-zero, someone shipped a partial fix without committing the spec — surface and stop.

### PIV-3. Confirm zero `banker_submitted` snapshots exist (the headline metric carried from SPEC-FLOW-V1)

```sql
SELECT COUNT(*) FROM credit_memo_snapshots
WHERE status = 'banker_submitted';
```

**Expected:** 0 at spec-write time. If non-zero, the V-12 chain has cleared and the production data has snapshots without lifecycle events — those need backfill (see PR3-B below).

### PIV-4. Confirm `advanceDealLifecycle` exists and is exported

```bash
grep -n "export.*advanceDealLifecycle\|export.*forceAdvanceLifecycle" \
  src/buddy/lifecycle/advanceDealLifecycle.ts
```

**Expected:** both functions exported. Confirms PR3 is wiring, not building.

### PIV-5. Identify what stage backfilled deals are at, to choose between `advance` and `forceAdvance`

```sql
SELECT 
  d.id, d.display_name, d.stage,
  EXISTS(SELECT 1 FROM credit_memo_snapshots s WHERE s.deal_id = d.id AND s.status = 'banker_submitted') AS has_submitted_memo
FROM deals d
WHERE d.id IN (
  '0279ed32-c25c-4919-b231-5790050331dd',
  '80fe6f7a-5c68-4f02-8bcf-933f246a9fc5',
  '0d31ebf3-485d-414e-a8ac-9b0e79884944',
  'e505cd1c-86b4-4d73-88e3-bc71ef342d94'
)
ORDER BY d.created_at DESC;
```

**Expected:** all 4 deals at `stage='underwriting'`, none with submitted memos. Confirms that when V-12 eventually walks, the source stage will be `underwriting` and the target will be `committee_ready` (skipping `underwrite_in_progress` and `committee_packet_missing` blockers — which means `forceAdvanceLifecycle` is the correct call, NOT `advanceDealLifecycle`).

### PIV-6. Read `ALLOWED_STAGE_TRANSITIONS` to confirm the legal transition path

```bash
grep -A 20 "ALLOWED_STAGE_TRANSITIONS:" src/buddy/lifecycle/model.ts
```

**Expected:** confirms `underwrite_in_progress → committee_ready` is the canonical transition. Submission moves the deal forward, but `committee_ready` has its own blockers (`committee_packet_missing`, `risk_pricing_not_finalized`, `structural_pricing_missing`) that may or may not be cleared at submission time. If they aren't, `advanceDealLifecycle` will return `{ ok: false, error: "blocked" }`.

### PIV-7. Confirm `committee_ready`'s blockers and decide handling

Read `getBlockersForTransition` in `advanceDealLifecycle.ts`. The blockers for `committee_ready` are:
- `committee_packet_missing`
- `risk_pricing_not_finalized`
- `structural_pricing_missing`

**Decide before code:** is "banker submitted memo" sufficient evidence that committee_ready is appropriate, even if these blockers exist? Two options:

- **Option A:** Use `forceAdvanceLifecycle` with reason `"banker_certified_memo"`. Bypasses blocker checks, writes `deal.lifecycle.force_advanced` event (different kind — be careful). Risk: bypasses legitimate gates.
- **Option B:** Use `advanceDealLifecycle`. If it returns `{ error: "blocked" }`, log warning and write a `deal.lifecycle.advance_attempted` event with the blockers list. Risk: deals never reach `committee_ready` programmatically until all gates clear, even though banker has certified.
- **Option C:** Introduce a new lifecycle stage `memo_submitted` that sits between `underwrite_in_progress` and `committee_ready`, and is the actual target of submission. Risk: schema change, model expansion, scope creep.

**Recommendation:** Option B. The lifecycle model already encodes "ready for committee" as a strict gate; banker certification is a precondition but not the only one. Submitting a memo with structural pricing missing should NOT auto-advance to `committee_ready` — that would defeat the purpose of the gate.

If the lifecycle advance is blocked, the snapshot is still written (canonical artifact preserved) and we write a `deal.lifecycle.advance_attempted` audit event capturing the blockers. Future PRs (and the V-12 chain) clear the blockers; lifecycle then advances on the next opportunity (typically a re-derivation triggered by `scheduleReadinessRefresh` from another event).

### PIV-8. Confirm test surface for the submission helper

```bash
ls src/lib/creditMemo/submission/__tests__/
grep -l "submitCreditMemoToUnderwriting" src/lib/creditMemo/submission/__tests__/*.test.ts
```

**Expected:** at least one test file targets `submitCreditMemoToUnderwriting`. PR3 will add a new test file specifically for the lifecycle integration and audit a few of the existing ones.

### PIV-9. Confirm CI-guard exists for the submission helper's audit-event contract

```bash
grep -rn "lifecycle_advanced\|deal.lifecycle.advanced" \
  src/lib/creditMemo/submission/__tests__/ src/lib/creditMemo/__tests__/
```

**Expected:** zero hits. PR3 adds the first such guard.

## Scope

### In scope (PR3)

#### PR3-A — Wire lifecycle advancement into submit, post-snapshot

The single PR. End state: every successful banker submission attempts a lifecycle advance and emits the appropriate audit event.

**A-1. Add the `advanceDealLifecycle` call to `submitCreditMemoToUnderwriting`.** Insert after the snapshot insert succeeds, before the `scheduleReadinessRefresh` call (which then becomes redundant). Pseudocode:

```ts
// After snapshot insert succeeds
const lifecycleResult = await advanceDealLifecycle(args.dealId, {
  type: "banker",
  id: args.bankerId,
});

if (!lifecycleResult.ok) {
  // Lifecycle advance failed — log and continue. The snapshot is the canonical
  // artifact; lifecycle is observability and recovers on next derivation.
  console.warn("[submitCreditMemoToUnderwriting] lifecycle advance failed", {
    dealId: args.dealId,
    bankerId: args.bankerId,
    snapshotId: insertRes.data.id,
    error: lifecycleResult.error,
    blockers: 'blockers' in lifecycleResult ? lifecycleResult.blockers.map((b) => b.code) : [],
  });
  
  // Telemetry: attempted advance with blockers (auditable trail)
  void writeEvent({
    dealId: args.dealId,
    kind: "deal.lifecycle.advance_attempted",
    actorUserId: args.bankerId,
    input: {
      trigger: "banker_memo_submitted",
      snapshotId: insertRes.data.id,
      result: lifecycleResult.error ?? "unknown",
      blockers: 'blockers' in lifecycleResult 
        ? lifecycleResult.blockers.map((b) => ({ code: b.code, message: b.message }))
        : [],
    },
  }).catch(() => {});
}
// Lifecycle success path: advanceDealLifecycle already wrote
// deal.lifecycle.advanced — no additional event needed here.
```

**A-2. Remove the redundant `scheduleReadinessRefresh` call.** `advanceDealLifecycle` already calls `deriveLifecycleState` which is the same state-derivation pathway. Keeping both is dead code. Add a comment noting the removal references SPEC-FLOW-V1 PR3.

**A-3. Add `deal.lifecycle.advance_attempted` to the `LedgerEventType` constant in `src/buddy/lifecycle/events.ts`** so the event kind is canonical. Format: `deal.lifecycle.advance_attempted`. Type the payload: `{ trigger: string; snapshotId: string; result: string; blockers: Array<{ code: string; message: string }> }`.

**A-4. Tests.**

- Unit: `submitCreditMemoToUnderwriting.lifecycleIntegration.test.ts` — three subtests:
  1. Successful submit + clear blockers → `deal.lifecycle.advanced` event written, deal stage advances.
  2. Successful submit + lifecycle blocked → snapshot still written, `deal.lifecycle.advance_attempted` event captures blockers.
  3. Successful submit + tenant_mismatch on lifecycle → snapshot still written, no lifecycle event leak.

- CI guard: `submissionLifecycleEventGuard.test.ts` — assert `submitCreditMemoToUnderwriting` source file calls `advanceDealLifecycle` exactly once and does NOT call `scheduleReadinessRefresh` directly.

- Integration: `lifecycleEventsAfterSubmit.integration.test.ts` — against a test deal, walk the submit flow end-to-end, verify the audit ledger has either `deal.lifecycle.advanced` or `deal.lifecycle.advance_attempted` after submit.

### Out of scope (explicit)

- Modifying `ALLOWED_STAGE_TRANSITIONS` or adding new stages (Option C from PIV-7 was rejected — separate spec if needed).
- Changing `getBlockersForTransition` rules — those gate `committee_ready` legitimately.
- Backfilling historical lifecycle events for past submissions (PIV-3 confirms this is empty).
- The 4 layer chain from SPEC-13.5 V-12 deferred findings (financial pipeline, research gate, doc finalization, borrower-flow consolidation) — those are separate specs.
- CommitteeAnticipationPanel data flow (out of PR3, in scope of SPEC-FLOW-V1 PR2 which is already shipped).
- `forceAdvanceLifecycle` usage — PR3 explicitly does NOT bypass blockers.

## Tests

(See A-4 above.)

## V-N verification checklist

- V-1. ☐ All 9 PIV outputs pasted into AAR.
- V-2. ☐ A-1: `advanceDealLifecycle` called in `submitCreditMemoToUnderwriting` after snapshot insert. Single call, with proper actor context.
- V-3. ☐ A-2: `scheduleReadinessRefresh` removed from submit, comment references SPEC-FLOW-V1 PR3.
- V-4. ☐ A-3: `deal.lifecycle.advance_attempted` added to `LedgerEventType`.
- V-5. ☐ A-4: Three subtests in `lifecycleIntegration.test.ts` passing.
- V-6. ☐ A-4: CI guard `submissionLifecycleEventGuard.test.ts` passing.
- V-7. ☐ tsc clean.
- V-8. ☐ pnpm test:unit shows expected new test count, all green.
- V-9. ☐ Post-deploy 24h check (after first banker submission attempt against this code):
  ```sql
  SELECT 
    kind, 
    input_json->'input'->>'from' AS from_stage,
    input_json->'input'->>'to' AS to_stage,
    COUNT(*)
  FROM audit_ledger
  WHERE kind IN ('deal.lifecycle.advanced', 'deal.lifecycle.advance_attempted')
    AND created_at > NOW() - INTERVAL '24 hours'
  GROUP BY 1, 2, 3;
  ```
  Expected: ≥ 1 row of either kind. If zero, the call site isn't firing.

## Files affected

| Path | Change | Risk |
|------|--------|------|
| `src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts` | Add lifecycle call, remove readiness refresh | Med — submit path is hot |
| `src/buddy/lifecycle/events.ts` | Add new event kind | Low |
| `src/lib/creditMemo/submission/__tests__/submitCreditMemoToUnderwriting.lifecycleIntegration.test.ts` | New | Low |
| `src/lib/creditMemo/__tests__/submissionLifecycleEventGuard.test.ts` | New | Low |
| `src/lib/creditMemo/submission/__tests__/lifecycleEventsAfterSubmit.integration.test.ts` | New | Low |

No migrations. No new tables.

## Risk register

1. **Lifecycle advance fails silently and snapshot is orphaned.** Mitigated by always writing `deal.lifecycle.advance_attempted` on failure, with the snapshot ID captured. Future debugging can correlate.

2. **Removing `scheduleReadinessRefresh` breaks the rail's CTA flip.** `advanceDealLifecycle` calls `syncBorrowerStatus` and re-derives state — this should be functionally equivalent. Verify in V-9 that the rail flips correctly post-submit.

3. **The `committee_ready` blockers reject every submit on real deals.** Likely on day 1 because the V-12 chain (research gate, financial pipeline, etc.) hasn't cleared. The `advance_attempted` event captures this; the snapshot still writes. Once the chain clears, future submits advance cleanly.

4. **Race between submit's lifecycle advance and a concurrent readiness derivation.** Both can attempt to advance. The lifecycle helper is not transactional. Worst case: duplicate `deal.lifecycle.advanced` events for the same transition. Mitigation: dedupe at query time via `(dealId, from, to, created_at)` window.

5. **`actor.type: "banker"` may not be a recognized value in `ActorContext`.** Verify by reading the type definition. If only `"system" | "borrower" | "builder" | "automation"` are allowed, use `"banker"` requires expanding the type — that's a clean addition but worth flagging.

## Hand-off commit message

```
spec(banker-flow): SPEC-FLOW-V1 PR3 — lifecycle advancement on banker submission

Currently submitCreditMemoToUnderwriting inserts the credit_memo_snapshots
row but never calls advanceDealLifecycle, so deal.lifecycle.advanced events
are not emitted for submission transitions. PIV-2 confirms zero such events
exist for submission reasons in production.

PR3 wires the lifecycle helper into the submission helper post-snapshot.
Failures don't roll back the snapshot — instead, deal.lifecycle.advance_attempted
captures the blockers for observability.

Single PR. No migrations. No new tables. Test coverage in 3 new files.

V-9 (post-deploy) confirms either deal.lifecycle.advanced or
deal.lifecycle.advance_attempted fires within 24h of first submission attempt
against deployed code.
```

## Addendum

1. **PR3 is independent of SPEC-13.5's V-12 chain.** Even with research/financial/doc gates failing, the lifecycle helper records the attempt with structured blocker data. The audit trail improves immediately; full lifecycle progression awaits the layer chain.

2. **`scheduleReadinessRefresh` is fire-and-forget; `advanceDealLifecycle` is not.** PR3 changes the submission helper's failure semantics. Old: snapshot insert succeeds, refresh runs in background, response returns. New: snapshot insert succeeds, lifecycle advance runs in foreground, response returns. The added latency is the cost of synchronous state advancement and is acceptable on a banker-initiated submit.

3. **The `actor.type: "banker"` value must be confirmed as accepted by the lifecycle helper.** Read `ActorContext` definition. If `"banker"` is not in the union, decide whether to expand the union or use `"user"` — and document the choice.
