# SPEC: Readiness Refresh vs Lifecycle Helper — Overlap Investigation

**Filed:** 2026-05 during SPEC-FLOW-V1 PR3 SR-2
**Originating context:** PR3 SR-2 confirmed `scheduleReadinessRefresh` and `advanceDealLifecycle` are NOT redundant — they serve different purposes and overlap only in `deriveLifecycleState`. This filing captures a deliberate-review-someday opportunity.

## Why this exists

PR3 SR-2 walked both helpers and found:

- `advanceDealLifecycle`: emits canonical `deal.lifecycle.advanced` event, enforces `ALLOWED_STAGE_TRANSITIONS`, syncs borrower-facing status. Calls `deriveLifecycleState` internally.
- `scheduleReadinessRefresh` → `refreshDealReadiness`: runs `buildUnifiedDealReadiness` with reconciliation + self-heal, then `reconcileDealLifecycle` (which can advance to `memo_inputs_required` / `underwrite_ready` independent of the canonical lifecycle event).

Both helpers can advance lifecycle stage, but only `advanceDealLifecycle` emits the canonical event. The reconcile path inside `scheduleReadinessRefresh` is a parallel advancement mechanism that does NOT emit `deal.lifecycle.advanced` for its transitions.

## Questions worth answering

1. **Should `reconcileDealLifecycle` emit the canonical event when it advances?** If yes, every transition is auditable from a single event kind. If no, document why the parallel path is intentional.
2. **Is the boundary between the two helpers documented anywhere?** Currently it's inferred by reading both files. A short doc comment in each would help.
3. **Are there other event-trigger surfaces that have the same pattern?** PR3 added `advanceDealLifecycle + scheduleReadinessRefresh` to the submission helper. The other 7 surfaces enumerated by `[v11-6]` CI guard call only `scheduleReadinessRefresh`. Should they also call `advanceDealLifecycle` for the canonical event? Or is submission special?
4. **Is `deriveLifecycleState` the natural overlap point, or is the duplication accidental?** Worth checking whether one helper's call to it could be skipped when the other has just run.

## Why not fix it now

Out of scope for PR3. The two helpers work; the [v11-6] CI guard enforces the readiness call; lifecycle events flow correctly when `advanceDealLifecycle` is the entry point. Refactoring the boundary requires an architectural decision about whether `reconcileDealLifecycle` should be an event-emitter, which isn't a small spec.

## Status

- Filed: 2026-05
- Owner: unassigned
- Blocker for: nothing currently
- Originating commit: SPEC-FLOW-V1 PR3 SR-2
- Estimated effort: 2-4h investigation + design doc, then a separate spec for the actual change
