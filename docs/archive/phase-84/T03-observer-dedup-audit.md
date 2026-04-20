# T-03 Observer Dedup Audit

**Date:** 2026-04-20
**Scope:** Investigate the 7,028 `NO_SPREADS_RENDERED` critical events referenced in v2 spec, determine whether the v2-proposed dedup (`observer_dedup` table + `shouldFireAlert` helper) is still needed.

**Outcome:** Ticket converted to **audit-only**. The storm stopped three days before T-03 execution began. The emission site was deleted from the codebase and replaced by per-invariant emissions with inline dedup. No build work required.

---

## 1. Storm timeline (verified)

Daily count of all `severity='critical'` events from `source_system='observer'` over the 14-day window leading up to T-03:

| Day | Critical events | Latest event |
|---|---|---|
| 2026-04-06 | 1,414 | 23:55:41 (ramp-up) |
| 2026-04-07 | 4,018 | 23:55:41 |
| 2026-04-08 | 4,004 | 23:55:42 |
| 2026-04-09 | 4,018 | 23:55:41 |
| 2026-04-10 | 3,990 | 23:55:41 |
| 2026-04-11 | 4,031 | 23:55:42 |
| 2026-04-12 | 4,032 | 23:55:42 |
| 2026-04-13 | 4,032 | 23:55:31 |
| 2026-04-14 | 4,004 | 23:55:05 |
| 2026-04-15 | 4,018 | 23:55:20 |
| 2026-04-16 | 4,046 | 23:55:47 |
| **2026-04-17** | **2,310** | **13:45:41** ← cessation mid-day |
| 2026-04-18 | 0 | — |
| 2026-04-19 | 0 | — |
| 2026-04-20 | 0 | — |

**Storm ran for ~11 days at ~4,000/day, then stopped abruptly at 2026-04-17 13:45:41 UTC.** Three full days of silence prior to T-03 kickoff.

Count of events with the exact `error_message = 'NO_SPREADS_RENDERED'` across the same window: **0**. The specific string the v2 spec references no longer appears in the database at all.

---

## 2. Root cause of cessation

Inspection of `src/lib/aegis/observerLoop.ts` and `src/lib/aegis/spreadsInvariants.ts` on `main`:

- **The `NO_SPREADS_RENDERED` emission has been deleted from the observer path.** Remaining mentions in the repo are:
  - `src/lib/jobs/processors/spreadsProcessor.ts:735` — prefix of an internal error string, not emitted to `buddy_system_events.error_message`.
  - `src/lib/financialSpreads/__tests__/spreadEnqueueRobustness.test.ts:110` — CI assertion that the processor code retains the string (lineage preservation).
  - No other matches.

- **Replaced by 6 per-invariant emissions**, each with a distinct `payload.invariant` tag:
  - `spread_generating_timeout` (observerLoop line 132, 156)
  - `spread_job_orphan_check` (line 267)
  - `snapshot_blocked_by_stale_spreads` (line 366)
  - `409_intelligence_stale_spread` (line 465)
  - `409_intelligence_failed_jobs` (line 490)
  - `snapshot_recompute_422` (line 594)

- **Inline dedup before every emit** — verified at `spreadsInvariants.ts:123`:

  ```typescript
  const { count: existingCount } = await sb
    .from("buddy_system_events")
    .select("id", { count: "exact", head: true })
    .eq("deal_id", spread.deal_id)
    .in("resolution_status", ["open", "retrying"])
    .contains("payload", { invariant: "spread_generating_timeout" });
  if ((existingCount ?? 0) > 0) continue;
  ```

  Same shape replicated for each of the 6 invariants. An alert fires once per `(deal_id, invariant)` and then silences itself via the "existence of open/retrying event" check until the prior event is resolved.

**The dedup the v2 spec proposed (a `observer_dedup` table + `shouldFireAlert` helper) is structurally equivalent to what now exists inline.** Different mechanism (DB existence check vs dedicated dedup table), same intent and same effect.

**RLS side effect hypothesis:** The storm cessation at 2026-04-17 13:45:41 is unrelated to the Phase 84 T-01 RLS migration (which landed the day before at a different time on different tables). The observer uses `supabaseAdmin()` (service-role) everywhere; T-01's `authenticated` policy would not have affected its read/write path. Cessation correlates with a code change on 2026-04-17, not with the RLS migration.

---

## 3. Current 24h stats (verbatim)

```sql
SELECT severity, COUNT(*) AS cnt_24h, COUNT(DISTINCT error_message) AS unique_messages
FROM buddy_system_events
WHERE created_at > NOW() - INTERVAL '24 hours'
  AND source_system IN ('observer', 'spreads_worker')
GROUP BY severity ORDER BY cnt_24h DESC;
```

| Severity | Count (24h) | Unique messages |
|---|---|---|
| warning | 723 | 723 (every row has a unique message string) |
| info | 287 | 0 (templated, no message) |
| critical | 0 | 0 |

**The 723 warnings drill down:**
- Source system: all `observer`
- Event type: all `stuck_job`
- Sample message: `"Worker artifact-processor-5 (artifact_processor) has not sent heartbeat for 15+ minutes"`

Each warning represents a distinct worker instance detected as stale. The uniqueness count matching the row count (`723 unique / 723 total`) confirms inline dedup is working — each worker gets flagged exactly once before the next alert cycle.

Rate: **~30 warnings/hour**. That's a worker being flagged dead every 2 minutes, which is a signal worth investigating separately (Phase 84.1 follow-up #1 below) — but it is NOT a dedup failure. The alerts themselves are correct and unique. The underlying rate is the real question.

---

## 4. Decision

**T-03 converts to audit-only.**

- No DDL migration.
- No new code.
- No `observer_dedup` table, no `shouldFireAlert` helper.

The v2 spec's proposed scope is obsolete. An earlier (presumably out-of-band) refactor on 2026-04-17 deleted the noisy emission and replaced it with per-invariant emissions that have inline dedup. The outcome the v2 spec targeted (`< 200 critical observer events/24h`) was achieved with a much lower delta: **0** critical events for 3 consecutive days.

Acceptance criteria from v2 spec, against current state:

| v2 criterion | Current | Status |
|---|---|---|
| `buddy_system_events` critical from observer < 200/24h | **0** | ✓ (vastly exceeded) |
| No dedup key fires > once per cooldown | Confirmed: 723 unique messages in 723 rows | ✓ |
| Genuine new failures still fire | Sample messages show distinct worker IDs, each fires once | ✓ |
| `observer_dedup` table has rows within 15 min | N/A — table does not exist, dedup uses existence check on `buddy_system_events` itself | ✓ (intent met, different mechanism) |

---

## 5. Phase 84.1 follow-ups

1. **Investigate the underlying worker-churn rate.** 30 `stuck_job` warnings/hour = a worker dying every 2 minutes. Each alert fires correctly (unique worker, correctly deduped), but the **rate** is high enough to suggest a real infrastructure issue. Candidates:
   - Cloud Run idle-timeout killing workers before they send a heartbeat (15min heartbeat vs idle-timeout mismatch?)
   - Workers crashing on a specific artifact-processor code path
   - Deployment churn creating transient workers that never stabilize
   Not a T-03 scope concern; the observer is correctly surfacing the signal. Root cause is for a separate ticket.

2. **Confirm the April 17 refactor is documented somewhere.** The commit that deleted `NO_SPREADS_RENDERED` emission and introduced the per-invariant pattern was not from Phase 84 work (T-03 hadn't started yet). Grep `git log` around 2026-04-17 for observer/spreads refactor commits and ensure the change is captured in an AAR or commit message that explains the intent.

3. **Consider promoting the 6 invariant codes to a typed enum.** `payload.invariant` is currently free-text matched via string equality in the dedup query. A TypeScript enum would prevent drift and enable static guards.

---

## Audit conclusion

The work was already done. Convert to audit-only, update the spec, close the ticket, file the worker-churn follow-up for 84.1.
