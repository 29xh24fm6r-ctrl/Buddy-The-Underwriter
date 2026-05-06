# SPEC-10 — Persistence & Cross-Session Intelligence

**Path:** `specs/banker-journey-fluidity/SPEC-10-persistence-cross-session-intelligence.md`
**Status:** Ready for implementation
**Owner:** Matt → Claude Code
**Branch:** off `main` (current: `feat/banker-analysis-alerts`)
**Depends on:** SPEC-01..09

---

## Goal

Move advisor feedback and behavioral memory from browser-local/session-local into persistent, deal-scoped intelligence while preserving deterministic advisor behavior.

SPEC-09 made the advisor adaptive within a session via local feedback, grouped signals, deterministic pattern detection, and canonical condition/override contracts. SPEC-10 should make that intelligence persist across sessions and devices.

---

## Primary objective

Move from:

```text
localStorage feedback + short-window patterns
```

to:

```text
persistent feedback + cross-session blocker memory + stronger behavioral intelligence
```

---

## Scope

### 1. Persist advisor feedback server-side

Recommended: **use `buddy_signal_ledger` for events, `buddy_advisor_feedback` for current state.**

```sql
create table buddy_advisor_feedback (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  deal_id uuid not null,
  user_id uuid,
  signal_key text not null,
  signal_kind text not null,
  signal_source text not null,
  state text not null check (state in ('acknowledged', 'dismissed', 'snoozed')),
  snoozed_until timestamptz,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_id, deal_id, user_id, signal_key)
);
```

---

### 2. Add feedback API

```text
GET    /api/deals/[dealId]/advisor/feedback
POST   /api/deals/[dealId]/advisor/feedback
DELETE /api/deals/[dealId]/advisor/feedback/[signalKey]
```

Every mutation also writes to `buddy_signal_ledger`:

```text
advisor_signal_acknowledged
advisor_signal_dismissed
advisor_signal_snoozed
advisor_signal_feedback_cleared
```

---

### 3. Upgrade `useAdvisorSignalFeedback`

```text
load server feedback first
fallback to localStorage if server fails
write server-side when available
mirror to localStorage as offline fallback
```

---

### 4. Persist blocker observations

```sql
create table buddy_blocker_observations (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  deal_id uuid not null,
  blocker_key text not null,
  blocker_kind text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  seen_count integer not null default 1,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_id, deal_id, blocker_key)
);
```

---

### 5. Add blocker observation API

```text
GET   /api/deals/[dealId]/advisor/blocker-observations
POST  /api/deals/[dealId]/advisor/blocker-observations
```

POST upserts observed blockers; absent codes get `resolved_at` stamped.

---

### 6. Promote lifecycleStage in telemetry hook

```ts
{
  id: string
  dealId: string
  kind: string
  label: string
  lifecycleStage?: string
  actionType?: string
  blockerId?: string
  createdAt: string
}
```

Makes `stage_oscillation` production-real.

---

### 7. Expand memory windows

```ts
type AdvisorMemoryWindow = "1h" | "24h" | "7d";
```

Defaults:

```text
panel summary       → 1h
pattern detection   → 24h
debug mode          → 7d
```

---

### 8. Add deterministic suppression learning

Rule:

```text
same signal dismissed >= 3 times
→ auto-suppress for 7 days
```

Stored as `state="snoozed", snoozed_until=now+7d, reason="repeated_dismissal"`. Still deterministic, not ML.

---

### 9. Add "Why am I seeing this?"

A lightweight `Why?` affordance in default mode. Reveals:

```text
rankReason
source
confidence
```

Debug mode (`?advisor=debug`) still shows `priority`, `signalKey`, `feedback state`.

---

## New files

```text
src/components/journey/stageViews/_shared/useBlockerObservations.ts
src/components/journey/__tests__/spec10-persistence-cross-session.test.ts

src/app/api/deals/[dealId]/advisor/feedback/route.ts
src/app/api/deals/[dealId]/advisor/feedback/[signalKey]/route.ts
src/app/api/deals/[dealId]/advisor/blocker-observations/route.ts

supabase/migrations/<timestamp>_create_buddy_advisor_feedback.sql
supabase/migrations/<timestamp>_create_buddy_blocker_observations.sql
```

---

## Modified files

```text
src/components/journey/stageViews/_shared/useAdvisorSignalFeedback.ts
src/components/journey/stageViews/_shared/useRecentCockpitTelemetry.ts
src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx

src/lib/journey/advisor/buildAdvisorMemorySummary.ts
src/lib/journey/advisor/buildCockpitAdvisorSignals.ts

src/components/journey/stageViews/DocumentsStageView.tsx
src/components/journey/stageViews/UnderwritingStageView.tsx
src/components/journey/stageViews/CommitteeStageView.tsx
src/components/journey/stageViews/DecisionStageView.tsx
src/components/journey/stageViews/ClosingStageView.tsx

specs/banker-journey-fluidity/SPEC-10-persistence-cross-session-intelligence.md
```

---

## Acceptance tests

1. Advisor feedback loads from server when available.
2. Advisor feedback falls back to localStorage when server fetch fails.
3. Acknowledge upserts server feedback.
4. Dismiss upserts server feedback.
5. Snooze upserts server feedback with `snoozed_until`.
6. Clearing feedback deletes server feedback and local fallback.
7. Feedback mutations write `advisor_signal_*` events to `buddy_signal_ledger`.
8. Repeated dismissals auto-snooze the signal for 7 days.
9. Server feedback overrides stale localStorage feedback.
10. Blocker observations persist `first_seen_at`.
11. Re-seen blockers update `last_seen_at` and `seen_count`.
12. Resolved blockers are marked `resolved_at`.
13. `stale_blocker` fires when `first_seen_at` is older than 24 hours.
14. `stale_blocker` does not fire for newly observed blockers.
15. `useRecentCockpitTelemetry` exposes `lifecycleStage`.
16. `stage_oscillation` works from live telemetry shape.
17. Memory summary supports 1h window.
18. Pattern detection supports 24h window.
19. Debug mode can use 7d window.
20. "Why am I seeing this?" reveals rankReason/source/confidence.
21. Default mode still hides priority and signalKey.
22. Advisor builder remains pure and does not fetch.
23. Feedback application remains outside the pure builder.
24. PrimaryActionBar still uses shared action execution.
25. StageBlockerList still uses shared action execution.
26. ForceAdvancePanel remains inside closed AdvancedDisclosure.
27. Existing SPEC-01..09 tests remain green.

---

## Recommended commits

```text
spec(journey): add persistent advisor intelligence contract
feat(journey): persist advisor signal feedback
feat(journey): add blocker observation memory
feat(journey): promote lifecycle stage in telemetry
feat(journey): add cross-session advisor suppression
feat(journey): expose advisor why metadata
test(journey): cover SPEC-10 persistence invariants
```

---

## PR title

```text
feat(journey): persist advisor feedback across sessions
```
