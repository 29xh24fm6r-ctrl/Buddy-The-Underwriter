# AAR — Phase 84 T-03 — Observer dedup / cooldown

**Date:** 2026-04-20
**Ticket:** T-03 (Wave 1 — converted to audit-only)
**Completion event:** `buddy_system_events` id `1f3d2358-2821-4675-91ee-0c11ede62c96`
**Audit doc:** `docs/archive/phase-84/T03-observer-dedup-audit.md`

---

## 1. Pre-work findings

**"Is it already fixed?" = YES.**

- Storm timeline verified: ~4,000 critical observer events/day from 2026-04-07 through 2026-04-16, tapering to 2,310 on 2026-04-17, then **0/day** for 2026-04-18 through 2026-04-20.
- Last critical observer event: `2026-04-17 13:45:41.516419+00`. Three full days of silence before T-03 execution began.
- `error_message = 'NO_SPREADS_RENDERED'` count over 14 days: **0**. That exact string has been deleted from the observer emission path.
- Code verification: `src/lib/aegis/observerLoop.ts` + `spreadsInvariants.ts` now emit 6 per-invariant codes (`spread_generating_timeout`, `spread_job_orphan_check`, `snapshot_blocked_by_stale_spreads`, `409_intelligence_stale_spread`, `409_intelligence_failed_jobs`, `snapshot_recompute_422`), each with an inline existence-check dedup at the emission site before `writeSystemEvent` fires.

An earlier out-of-band refactor (on or before 2026-04-17 13:45:41 UTC) solved this ticket before it was queued.

---

## 2. Spec deviation

**Full ticket converted to audit-only.** The v2 spec proposed building an `observer_dedup` table and `shouldFireAlert` helper. Neither is required — a structurally equivalent dedup already exists inline at each emission site in `spreadsInvariants.ts`.

No DDL, no code, no schema changes.

Pattern matches T-05 exactly: pre-work surfaced that the fix was already in place, so the ticket deliverable becomes an audit doc + deprecation/documentation trail rather than implementation.

---

## 3. Acceptance (verbatim)

### Daily critical-event rollup (14 days)

```
day          critical_events  latest_event
2026-04-06         1,414      23:55:41
2026-04-07         4,018      23:55:41
2026-04-08 to 16   ~4,000/day  (steady storm)
2026-04-17         2,310      13:45:41 ← cessation mid-day
2026-04-18         0
2026-04-19         0
2026-04-20         0
```

### Current 24h breakdown

```
severity   count_24h   unique_messages
warning        723           723   (100% unique → dedup working)
info           287             0   (templated, no message text)
critical         0             0
```

### v2 acceptance criteria vs current state

| v2 criterion | Current | Status |
|---|---|---|
| `buddy_system_events` critical from observer < 200/24h | **0** | ✓ (vastly exceeded) |
| No dedup key fires > once per cooldown | 723 unique / 723 rows | ✓ |
| Genuine new failures still fire immediately | Distinct worker IDs per warning | ✓ |
| `observer_dedup` table populated within 15 min | N/A — different mechanism (existence check on buddy_system_events itself) | ✓ (intent met) |

---

## 4. Phase 84.1 follow-ups

1. **Investigate worker-churn rate.** 722 of the 723 warnings are `stuck_job` events with messages like `"Worker artifact-processor-5 (artifact_processor) has not sent heartbeat for 15+ minutes"`. Rate ≈ 30/hour = a worker being flagged dead every 2 minutes. Each alert is unique and correctly deduped — the signal is real. Likely causes: Cloud Run idle-timeout, worker crashes on specific code paths, deployment churn. Not a T-03 scope concern; the observer is doing its job surfacing this. Root cause needs a separate ticket.

2. **Attribute the April 17 refactor.** The commit that deleted `NO_SPREADS_RENDERED` emission and introduced per-invariant dedup was NOT part of Phase 84 work (T-03 hadn't started). Worth `git log --before='2026-04-17 14:00' --after='2026-04-17' -- src/lib/aegis/` to find the commit and ensure its intent is documented.

3. **Consider typed enum for `payload.invariant`.** Currently free-text matched via string equality in the dedup query. A TypeScript enum would prevent drift and enable static guards.

---

## 5. Meta-lesson for future phase audits

**Wave 1 ("Stop the bleeding") tickets have a real risk of being already-fixed by the time they're queued**, because they describe acute operational pain that frequently triggers out-of-band fixes between spec-drafting and spec-execution. In Phase 84 alone:

- **T-02** classifier bug: fix was partially shipped (Gemini classifier added) but a distinct `maxOutputTokens` cap bug existed → partial execution needed.
- **T-03** observer storm: fix was fully shipped before T-03 started → converted to audit-only.
- **T-06** idempotency: dedup columns and index were pre-staged by the user before T-06 started → spec adjusted mid-flight.

Future Wave 1 pre-work should query the affected surface for current-state evidence *first*, before implementing anything. The "is it already fixed?" check earns its keep.

---

## Next

T-07 (narrow Omega fallback in `/api/deals/[dealId]/underwrite/state`) per execution order. Remaining tickets after T-07: T-08, T-09, T-10A.
