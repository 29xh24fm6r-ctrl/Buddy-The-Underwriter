# SPEC-11 — Intelligence Refinement & Safety

**Path:** `specs/banker-journey-fluidity/SPEC-11-intelligence-refinement-safety.md`
**Status:** Ready for implementation
**Owner:** Matt → Claude Code
**Branch:** off `main` (current: `feat/banker-analysis-alerts`)
**Depends on:** SPEC-01..10

---

## Goal

Harden the persistent advisor system from SPEC-10 with database safety, cleaner persistence behavior, lower write noise, and deterministic predictive signals.

---

## Primary objective

Move from:

```text
persistent advisor memory
```

to:

```text
safe, durable, low-noise, prediction-capable advisor intelligence
```

---

## Scope

### 1. RLS for advisor persistence tables

Tables:

```text
buddy_advisor_feedback
buddy_blocker_observations
```

Add RLS + per-bank policies. Use the existing helper: `public.get_current_bank_id()`.

---

### 2. Server-side snooze filtering

`GET /api/deals/[dealId]/advisor/feedback` returns active feedback only:

```sql
state != 'snoozed' OR snoozed_until IS NULL OR snoozed_until > now()
```

Do not rely on client filtering.

---

### 3. Persist dismiss count server-side

```sql
alter table buddy_advisor_feedback
  add column if not exists dismiss_count integer not null default 0,
  add column if not exists last_dismissed_at timestamptz;
```

Behavior:

```text
dismiss → increment dismiss_count
dismiss_count >= 3 → state="snoozed", snoozed_until=now+7d, reason="repeated_dismissal"
```

Replaces the SPEC-10 browser-only counter.

---

### 4. Debounce blocker observation writes

```text
blocker set changes → wait 250ms → POST once
sorted keys dedupe   → identical sets skip
```

---

### 5. Low-signal-value detection

New signal kind: `low_signal_value`.

```text
same signal dismissed >= 3 times
OR acknowledged but never acted on within 24h
```

```text
severity   = "info"
source     = "telemetry"
confidence = 0.75
priority   = low unless repeated across multiple signals
```

Mainly debug/admin tuning. Not banker-facing urgency.

---

### 6. Deterministic predictive signals

New signal kind: `predictive_warning`.

```text
likely_committee_delay
  committee_required = true
  AND committee_packet_ready = false
  AND (memo gaps > 0 OR blockers > 0)

missing_required_condition
  closing stage
  AND open critical/warning conditions exist

high_risk_override_cluster
  unresolved overrides >= 3
  OR critical overrides >= 1
```

No LLM, no probability model. Add `predictionReason` field to predictive signals.

---

### 7. Advisor admin/debug tuning surface

`?advisor=debug` exposes:

```text
priority / confidence / rankReason / predictionReason
signalKey / feedback state / dismiss_count / source
```

Default mode hides debug-only metadata.

---

## New files

```text
src/components/journey/__tests__/spec11-intelligence-refinement-safety.test.ts
supabase/migrations/<timestamp>_add_rls_and_dismiss_counts_to_advisor_tables.sql
```

---

## Modified files

```text
src/app/api/deals/[dealId]/advisor/feedback/route.ts
src/app/api/deals/[dealId]/advisor/feedback/[signalKey]/route.ts
src/app/api/deals/[dealId]/advisor/blocker-observations/route.ts

src/components/journey/stageViews/_shared/useBlockerObservations.ts
src/components/journey/stageViews/_shared/useAdvisorSignalFeedback.ts
src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx

src/lib/journey/advisor/buildAdvisorMemorySummary.ts
src/lib/journey/advisor/buildCockpitAdvisorSignals.ts

specs/banker-journey-fluidity/SPEC-11-intelligence-refinement-safety.md
```

---

## Acceptance tests

1. advisor feedback table has RLS enabled.
2. blocker observations table has RLS enabled.
3. advisor feedback policies restrict rows by bank_id.
4. blocker observation policies restrict rows by bank_id.
5. feedback GET excludes expired snoozes.
6. expired snoozes do not suppress advisor signals.
7. dismiss increments server `dismiss_count`.
8. `dismiss_count >= 3` auto-snoozes signal for 7 days.
9. server `dismiss_count` replaces browser-only repeated dismissal logic.
10. clear feedback resets state and `dismiss_count`.
11. `useBlockerObservations` debounces writes.
12. `useBlockerObservations` does not POST unchanged blocker sets.
13. blocker observations still mark resolved blockers.
14. `low_signal_value` emits for repeatedly dismissed signals.
15. `low_signal_value` remains low priority.
16. `likely_committee_delay` emits when committee packet is not ready and memo/blockers remain.
17. `missing_required_condition` emits in closing with open warning/critical conditions.
18. `high_risk_override_cluster` emits for unresolved override clusters.
19. predictive_warning signals include `predictionReason`.
20. predictive signals remain deterministic and do not call fetch.
21. predictive signals rank below critical blockers but above generic recent changes.
22. debug mode shows `dismiss_count` and `predictionReason`.
23. default advisor mode hides debug-only metadata.
24. PrimaryActionBar still uses shared action execution.
25. StageBlockerList still uses shared action execution.
26. ForceAdvancePanel remains inside closed AdvancedDisclosure.
27. Existing SPEC-01..10 journey tests remain green.

---

## Recommended commits

```text
spec(journey): add intelligence refinement and safety contract
feat(journey): add rls to advisor persistence tables
feat(journey): harden advisor feedback persistence
feat(journey): debounce blocker observations
feat(journey): add low-signal advisor detection
feat(journey): add deterministic predictive advisor warnings
test(journey): cover SPEC-11 safety and intelligence invariants
```

---

## PR title

```text
feat(journey): harden advisor intelligence persistence
```
