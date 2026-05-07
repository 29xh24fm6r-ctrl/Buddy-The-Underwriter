# SPEC-FLOW-V1 PR3 — Lifecycle Advancement on Banker Submission

**Status:** Ready for Claude Code (PIVs complete, drift corrections incorporated)
**Owner:** Matt (architecture) → Claude Code (implementation)
**Branch:** opens against `feat/spec-flow-v1-pr3-lifecycle-advancement`
**Depends on:** SPEC-FLOW-V1 PR1 (`2647e1a4`), PR2 (`ee569aa5`), SPEC-13.5 closed
**Blocks:** Nothing critical. PR4 (spread janitor) and PR5 (deal-creation guidance) are independent. PR3 unblocks downstream observability work.

## Problem in one paragraph

When a banker submits a credit memo via `submitCreditMemoToUnderwriting`, the function correctly inserts a row to `credit_memo_snapshots` with `status='banker_submitted'`, then calls `scheduleReadinessRefresh` (fire-and-forget, derives lifecycle state from data). It does NOT call `advanceDealLifecycle()`, which means the canonical lifecycle event `deal.lifecycle.advanced` is never written to `deal_events` for the submission transition, and the underlying deal stage is never advanced via the canonical helper. Consequences: (1) the audit ledger has no record of "banker certified this memo at this time" as a lifecycle event — only as an opaque snapshot insert; (2) downstream readers that watch `deal.lifecycle.advanced` for stage transitions never see the submission; (3) the `scheduleReadinessRefresh` derivation may or may not flip the deal to a new stage depending on what `deriveLifecycleState` reads from data, but no explicit transition is recorded; (4) the `from`/`to` pair specifying which stage the submission moved the deal into is lost.

## Solution in one paragraph

Add a call to `advanceDealLifecycle()` in `submitCreditMemoToUnderwriting` immediately after the snapshot row is successfully inserted. The call passes the dealId and an `ActorContext` with `type: "banker"` and `id: args.bankerId`. The lifecycle helper handles transition-rule checks, blocker evaluation, ledger event emission, and underlying stage sync. Three nuances: (1) the readiness contract gate (`evaluateMemoReadinessContract`) ensures the deal is at canonical stage `underwrite_in_progress` at submit-time — bankers can't reach the submit endpoint without passing readiness, which itself requires the deal be in a state where memo submission is meaningful. The transition is therefore a single canonical hop `underwrite_in_progress → committee_ready` and `advanceDealLifecycle` (not `forceAdvance`) is correct; (2) `advanceDealLifecycle` already calls `deriveLifecycleState` and `syncBorrowerStatus` internally, so the existing `scheduleReadinessRefresh` call in the submission helper becomes redundant — remove it; (3) lifecycle advancement failures should NOT roll back the snapshot insert (the snapshot is the canonical artifact; lifecycle is observability). On lifecycle failure (e.g., `committee_ready` blockers like `committee_packet_missing`), log a warning, write a `deal.lifecycle.advance_attempted` audit event capturing the blockers, return success.

## PIV — pre-implementation verification (already run, results captured)

The 9 PIVs were executed during spec authorship; results retained for posterity and re-verification.

### PIV-1. Submit doesn't call advanceDealLifecycle

```bash
grep -n "advanceDealLifecycle\|forceAdvanceLifecycle\|deal.lifecycle.advanced\|lifecycle_advanced" \
  src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts
```

**Result:** zero hits. Confirms Fix #2 is the missing call.

### PIV-2. Zero historical submission lifecycle events

```sql
SELECT COUNT(*) AS submission_lifecycle_events
FROM audit_ledger
WHERE kind = 'deal.lifecycle.advanced'
  AND (input_json->'input'->>'reason' = 'submission_completed'
       OR input_json->'input'->>'reason' LIKE '%banker_submitted%');
```

**Result:** 0. No partial fix shipped.

### PIV-3. Zero `banker_submitted` snapshots

```sql
SELECT COUNT(*) FROM credit_memo_snapshots WHERE status = 'banker_submitted';
```

**Result:** 0. PR3-B (backfill) is empty and dropped.

### PIV-4. Both lifecycle helpers exported

```bash
grep -n "export.*advanceDealLifecycle\|export.*forceAdvanceLifecycle" \
  src/buddy/lifecycle/advanceDealLifecycle.ts
```

**Result:** both exported. PR3 is wiring, not building.

### PIV-5. Stage state of the 4 SPEC-13.5 backfill deals — TWO STAGE NAMESPACES NOTED

**Important:** two stage namespaces exist and `deals.stage` does not unambiguously identify the canonical lifecycle stage:

- **`deals.stage` column** (5-stage legacy/underlying): `created | intake | collecting | underwriting | ready`
- **Canonical `LifecycleStage`** (12-stage model): `intake_created | docs_requested | docs_in_progress | docs_satisfied | memo_inputs_required | underwrite_ready | underwrite_in_progress | committee_ready | committee_decisioned | closing_in_progress | closed | workout`

The mapping is in `mapToUnderlyingStage()` at `src/buddy/lifecycle/advanceDealLifecycle.ts:284-303`. A `deals.stage='collecting'` row could be at any of `docs_in_progress`, `docs_satisfied`, `memo_inputs_required`, or `underwrite_ready` canonically. Querying `deals.stage` alone cannot tell you which.

**Actual data:**

| Deal | `deals.stage` | has_submitted_memo |
|------|---------------|--------------------|
| Samaritus Yacht Management | `underwriting` | false |
| OmniCare 365 May 1 2026 | `collecting` | false |
| OmniCare 365 Review | `collecting` | false |
| Test Pack 4-23-26 Test #1 | `collecting` | false |

Only Samaritus is meaningfully near submission. The other 3 are still upstream (canonical lifecycle is `docs_in_progress` or earlier) and the readiness contract will reject any submit attempt against them. **This is by design** — the readiness gate is the upstream filter that ensures only deals at canonical `underwrite_in_progress` reach submit.

### PIV-6. ALLOWED_STAGE_TRANSITIONS

Confirmed transition: `underwrite_in_progress → committee_ready` is the canonical submission hop.

### PIV-7. committee_ready blockers

Three blockers gate `committee_ready`:
- `committee_packet_missing` (`advanceDealLifecycle.ts:253-254`)
- `risk_pricing_not_finalized` (`advanceDealLifecycle.ts:265-266`)
- `structural_pricing_missing` (`advanceDealLifecycle.ts:268-269`)

**Decision: Option B (use `advanceDealLifecycle`).** Rationale:

- **Option A** (`forceAdvanceLifecycle` with reason `"banker_certified_memo"`) bypasses these gates. Rejected: the gates exist for a reason — pricing and packet completeness are real preconditions for committee, and a banker certifying the memo doesn't make a missing committee packet appear.
- **Option B** (`advanceDealLifecycle`, capture blockers on failure). Recommended: respects the gates, emits `deal.lifecycle.advance_attempted` audit event when blocked so the observability still improves, snapshot still writes regardless.
- **Option C** (introduce new `memo_submitted` stage between `underwrite_in_progress` and `committee_ready`). Rejected: schema change, model expansion, scope creep.

If the lifecycle advance is blocked, the snapshot is still written (canonical artifact preserved) and we write a `deal.lifecycle.advance_attempted` audit event capturing the blockers. Future PRs (and the V-12 chain) clear the blockers; lifecycle then advances on the next opportunity (typically a re-derivation triggered by a downstream event).

### PIV-8. Test surface

Three existing test files in `src/lib/creditMemo/submission/__tests__/`:
- `computeInputHash.test.ts`
- `evaluateMemoReadinessContract.test.ts`
- `ownershipInvariantGuard.test.ts` (the one that gates `status='banker_submitted'` writes)

PR3 adds 3 new test files alongside these.

### PIV-9. No existing CI guard for lifecycle-event contract

Zero hits across `src/lib/creditMemo/submission/__tests__/` and `src/lib/creditMemo/__tests__/`. PR3 ships the first such guard.

## Scope

### In scope (PR3)

The single PR. End state: every successful banker submission attempts a lifecycle advance and emits the appropriate audit event (`deal.lifecycle.advanced` on success, `deal.lifecycle.advance_attempted` on blocked).

#### A-1. Add `advanceDealLifecycle` call to `submitCreditMemoToUnderwriting`

Insert after the snapshot insert succeeds, before the `scheduleReadinessRefresh` call (which is removed in A-2). Pseudocode:

```ts
import { advanceDealLifecycle } from "@/buddy/lifecycle/advanceDealLifecycle";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { LedgerEventType } from "@/buddy/lifecycle/events";

// ... after snapshot insert succeeds at insertRes.data.id ...

const lifecycleResult = await advanceDealLifecycle(args.dealId, {
  type: "banker",
  id: args.bankerId,
});

if (!lifecycleResult.ok) {
  // Lifecycle advance failed — snapshot is preserved; lifecycle is observability.
  // Write structured advance_attempted event so blockers are captured for debugging.
  console.warn("[submitCreditMemoToUnderwriting] lifecycle advance failed", {
    dealId: args.dealId,
    bankerId: args.bankerId,
    snapshotId: insertRes.data.id,
    error: lifecycleResult.error,
    blockers:
      "blockers" in lifecycleResult
        ? lifecycleResult.blockers.map((b) => b.code)
        : [],
  });

  void writeEvent({
    dealId: args.dealId,
    kind: LedgerEventType.lifecycle_advance_attempted, // see A-3
    actorUserId: args.bankerId,
    input: {
      trigger: "banker_memo_submitted",
      snapshot_id: insertRes.data.id,
      result: lifecycleResult.error ?? "unknown",
      blockers:
        "blockers" in lifecycleResult
          ? lifecycleResult.blockers.map((b) => ({
              code: b.code,
              message: b.message,
            }))
          : [],
    },
  }).catch(() => {});
}
// Lifecycle success path: advanceDealLifecycle already wrote
// deal.lifecycle.advanced — no additional event needed here.
```

#### A-2. Remove the redundant `scheduleReadinessRefresh` call

`advanceDealLifecycle` internally calls `deriveLifecycleState` and `syncBorrowerStatus` — these cover the same state-derivation pathway that `scheduleReadinessRefresh` was triggering. Keeping both is dead code.

Add an inline comment at the removal site:

```ts
// SPEC-FLOW-V1 PR3: scheduleReadinessRefresh removed. advanceDealLifecycle
// (called above) now handles state derivation + borrower-status sync inline.
```

#### A-3. Add `deal.lifecycle.advance_attempted` to `LedgerEventType`

In `src/buddy/lifecycle/events.ts`, add:

```ts
// Lifecycle advancement attempt (blocked path)
lifecycle_advance_attempted: "deal.lifecycle.advance_attempted",
```

Add typed payload:

```ts
export type LifecycleAdvanceAttemptedPayload = {
  trigger: string;
  snapshot_id: string;
  result: string;
  blockers: Array<{ code: string; message: string }>;
};
```

#### A-4. Tests

Three new files:

**`src/lib/creditMemo/submission/__tests__/submitCreditMemoToUnderwriting.lifecycleIntegration.test.ts`**

Three subtests with mocked `advanceDealLifecycle`:

1. **Successful submit + clear lifecycle path** — submit succeeds, snapshot inserted, `advanceDealLifecycle` returns `{ ok: true, advanced: true }`. Verify: no `lifecycle_advance_attempted` event written, snapshot ID returned in result.
2. **Successful submit + blocked lifecycle (`committee_packet_missing`)** — submit succeeds, snapshot inserted, `advanceDealLifecycle` returns `{ ok: false, error: "blocked", blockers: [...] }`. Verify: snapshot ID still returned, `lifecycle_advance_attempted` event written with the blocker codes captured.
3. **Successful submit + lifecycle helper throws** — submit succeeds, snapshot inserted, mock makes `advanceDealLifecycle` throw. Verify: thrown error doesn't crash submit, snapshot ID still returned, `lifecycle_advance_attempted` event written with `result: "exception"` or similar.

**`src/lib/creditMemo/__tests__/submissionLifecycleEventGuard.test.ts`**

Source-level CI guard. Reads `submitCreditMemoToUnderwriting.ts` as text:

- Asserts source contains `advanceDealLifecycle(` exactly once
- Asserts source does NOT contain `scheduleReadinessRefresh` (post-A-2)
- Asserts source contains `LedgerEventType.lifecycle_advance_attempted` for the failure path

This guard prevents future regressions where someone re-adds `scheduleReadinessRefresh` or removes the lifecycle call.

**`src/lib/creditMemo/submission/__tests__/lifecycleEventsAfterSubmit.integration.test.ts`**

Integration-level (uses real Supabase admin client against test fixtures). Walks the submit flow end-to-end against a synthetic test deal at `underwrite_in_progress`, asserts the audit ledger has either `deal.lifecycle.advanced` or `deal.lifecycle.advance_attempted` after submit (with the appropriate `from`/`to` or `blockers` fields populated).

### Out of scope (explicit)

- Modifying `ALLOWED_STAGE_TRANSITIONS` or adding new stages (Option C from PIV-7 was rejected).
- Changing `getBlockersForTransition` rules — those gate `committee_ready` legitimately.
- Backfilling historical lifecycle events for past submissions (PIV-3 confirms this is empty; backfill PR is dropped).
- The 4-layer chain from SPEC-13.5 V-12 deferred findings (financial pipeline, research gate, doc finalization, borrower-flow consolidation) — separate specs.
- CommitteeAnticipationPanel data flow (out of PR3, in scope of PR2 already shipped).
- `forceAdvanceLifecycle` usage — PR3 explicitly does NOT bypass blockers.

## V-N verification checklist

- V-1. ☐ All 9 PIV outputs re-verified at PR-open time and pasted into AAR. (PIVs were captured at spec-write time; if anything has drifted between then and PR-open, surface in AAR per principle #16.)
- V-2. ☐ A-1: `advanceDealLifecycle` called in `submitCreditMemoToUnderwriting` after snapshot insert. Single call, with proper actor context (`type: "banker"`, `id: bankerId`).
- V-3. ☐ A-2: `scheduleReadinessRefresh` removed from submit. Inline comment references SPEC-FLOW-V1 PR3.
- V-4. ☐ A-3: `LedgerEventType.lifecycle_advance_attempted` added to events.ts; payload type added.
- V-5. ☐ A-4: Three subtests in `submitCreditMemoToUnderwriting.lifecycleIntegration.test.ts` passing.
- V-6. ☐ A-4: CI guard `submissionLifecycleEventGuard.test.ts` passing (3 source-level assertions).
- V-7. ☐ A-4: Integration test `lifecycleEventsAfterSubmit.integration.test.ts` passing.
- V-8. ☐ tsc clean.
- V-9. ☐ pnpm test:unit shows expected new test count, all green (1 deliberate-red from `pipelineRecompute` remains until SPEC-pipeline-recompute-auth-policy resolves).
- V-10. ☐ Post-deploy 24h check (after first banker submission attempt against deployed code):
  ```sql
  SELECT
    kind,
    input_json->'input'->>'from' AS from_stage,
    input_json->'input'->>'to' AS to_stage,
    input_json->'input'->>'trigger' AS trigger,
    COUNT(*)
  FROM audit_ledger
  WHERE kind IN ('deal.lifecycle.advanced', 'deal.lifecycle.advance_attempted')
    AND created_at > NOW() - INTERVAL '24 hours'
  GROUP BY 1, 2, 3, 4;
  ```
  Expected: ≥ 1 row of either kind. If zero, the call site isn't firing — investigate.

## Files affected

| Path | Change | Risk |
|------|--------|------|
| `src/lib/creditMemo/submission/submitCreditMemoToUnderwriting.ts` | Add lifecycle call, remove readiness refresh | Med — submit path is hot |
| `src/buddy/lifecycle/events.ts` | Add new event kind + payload type | Low |
| `src/lib/creditMemo/submission/__tests__/submitCreditMemoToUnderwriting.lifecycleIntegration.test.ts` | New | Low |
| `src/lib/creditMemo/__tests__/submissionLifecycleEventGuard.test.ts` | New | Low |
| `src/lib/creditMemo/submission/__tests__/lifecycleEventsAfterSubmit.integration.test.ts` | New | Low |

No migrations. No new tables. No schema changes.

## Risk register

1. **Lifecycle advance fails silently and snapshot is orphaned in observability terms.** Mitigated by always writing `deal.lifecycle.advance_attempted` on failure with the snapshot ID captured. Future debugging can correlate snapshot to attempted advance.

2. **Removing `scheduleReadinessRefresh` breaks the rail's CTA flip.** `advanceDealLifecycle` internally calls `syncBorrowerStatus` (which writes `deal_status` and emits `status_synced` event) and re-derives state — this should be functionally equivalent. Verify in V-10 (post-deploy spot-check) that the rail flips correctly.

3. **The `committee_ready` blockers reject every submit on real deals on day 1.** Likely true because the V-12 chain (research gate, financial pipeline, etc.) hasn't cleared. The `advance_attempted` event captures this; the snapshot still writes. Once the chain clears, future submits advance cleanly. Acceptable initial state.

4. **Race between submit's lifecycle advance and a concurrent readiness derivation triggered by another event.** Both can attempt to advance. The lifecycle helper is not transactional. Worst case: duplicate `deal.lifecycle.advanced` events for the same transition. Mitigation: dedupe at query time via `(deal_id, from, to, created_at)` window. Not blocking; observability tolerates.

5. **`scheduleReadinessRefresh` may have been doing something `advanceDealLifecycle` doesn't replicate.** Read `refreshDealReadiness.ts` source as part of A-2 to verify the removal is safe. If `scheduleReadinessRefresh` does anything beyond state derivation + borrower status sync, file as a follow-up — but don't block PR3 on it.

## Hand-off commit message (for the implementation PR)

```
feat(banker-flow): wire advanceDealLifecycle into submit (SPEC-FLOW-V1 PR3)

Currently submitCreditMemoToUnderwriting inserts the credit_memo_snapshots
row but does not call advanceDealLifecycle, so deal.lifecycle.advanced
events are not emitted for submission transitions. PIV-2 confirmed zero
such events exist in production.

This PR wires the lifecycle helper into the submission helper after the
snapshot insert. On lifecycle blocked (e.g., committee_packet_missing),
the snapshot is preserved and a deal.lifecycle.advance_attempted audit
event captures the blocker codes for observability.

scheduleReadinessRefresh is removed (advanceDealLifecycle subsumes it).

Single PR. No migrations. No new tables. 3 new test files (1 integration,
1 unit, 1 CI guard).

V-10 (post-deploy) confirms either deal.lifecycle.advanced or
deal.lifecycle.advance_attempted fires within 24h of first submission
attempt against deployed code.
```

## Addendum

1. **PR3 is independent of SPEC-13.5's V-12 chain.** Even with research / financial / doc gates failing, the lifecycle helper records the attempt with structured blocker data. The audit trail improves immediately; full lifecycle progression awaits the layer chain.

2. **`scheduleReadinessRefresh` is fire-and-forget; `advanceDealLifecycle` is not.** PR3 changes the submission helper's failure semantics. Old: snapshot insert succeeds, refresh runs in background, response returns. New: snapshot insert succeeds, lifecycle advance runs in foreground, response returns. The added latency is the cost of synchronous state advancement and is acceptable on a banker-initiated submit.

3. **PIV-5 stage-namespace clarification is critical for AAR readers.** Future maintainers reading test fixtures or production data should know `deals.stage='collecting'` does NOT mean canonical `docs_in_progress` — it could be any of four canonical sub-stages. Always reference `mapToUnderlyingStage` in `advanceDealLifecycle.ts:284-303` when correlating the two namespaces.
