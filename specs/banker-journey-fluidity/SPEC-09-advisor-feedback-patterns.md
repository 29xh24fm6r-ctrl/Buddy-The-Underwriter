# SPEC-09 — Advisor Feedback Loop & Signal Refinement

**Path:** `specs/banker-journey-fluidity/SPEC-09-advisor-feedback-patterns.md`
**Status:** Ready for implementation
**Owner:** Matt → Claude Code
**Branch:** off `main` (current: `feat/banker-analysis-alerts`)
**Depends on:** SPEC-01..08

---

## Goal

Reduce advisor noise, detect repeated workflow patterns, expose ranking/debug metadata, and finish contract normalization without making the advisor probabilistic or opaque.

SPEC-08 made the cockpit advisor live, ranked, confidence-aware, and telemetry-grounded. SPEC-09 should now let bankers shape the signal surface and let the system detect repeated behavior patterns deterministically.

---

## Primary objective

Move from:

```text
live ranked advisor
```

to:

```text
feedback-aware advisor with deterministic pattern detection and normalized contracts
```

---

## Scope

### 1. Add signal acknowledgment / snooze

`useAdvisorSignalFeedback` hook backed by `localStorage`. No backend persistence yet.

```ts
type AdvisorSignalFeedback = {
  signalKey: string
  dealId: string
  state: "acknowledged" | "dismissed" | "snoozed"
  until?: string
  createdAt: string
}
```

Signal key: stable across renders.

```text
dealId + signal.kind + signal.source + signal.title
```

Behavior:

```text
dismissed       → hidden
snoozed active  → hidden until timestamp
acknowledged    → visible but deemphasized
```

---

### 2. Add deterministic pattern detection

New signal kind: `behavior_pattern_warning`.

```text
repeated_action_failure   → same actionType failed >= 3 times in window
repeated_inline_undo      → cockpit_inline_mutation_undone >= 2 times
stage_oscillation         → same deal moved between stages >= 3 times
stale_blocker             → blocker present for > 24h IF createdAt available
```

No AI. No inference beyond rules.

---

### 3. Add adaptive deterministic ranking

```text
priority =
    base priority
  + severity bump
  + recency bump
  + repetition bump
  + feedback adjustment
  + actionability bump
```

Adjustments:

```text
dismissed                 hidden
snoozed                   hidden until expiry
acknowledged              -150 priority
repeated failure          +200
repeated undo             +150
action available          +75
recent telemetry < 5 min  +50
```

Confidence remains deterministic.

---

### 4. Add advisor debug mode

`?advisor=debug` URL flag. Show:

```text
priority / confidence / rankReason / source / signalKey / feedback state
```

Default banker view stays clean.

---

### 5. Group advisor signals visually

```text
Critical            (severity="critical")
Needs Attention     (warnings excluding recent_change)
Suggested Actions   (next_best_action)
Recent Activity     (recent_change)
Acknowledged        (acknowledged signals)
```

Dismissed / snoozed signals never render.

---

### 6. Normalize condition contract fully

Migrate editors + fallbacks to `DealConditionRow` from `src/lib/journey/contracts/conditions.ts`. Endpoints return contract-compatible rows. `items` alias may stay one more cycle but must be commented as deprecated and tested.

---

### 7. Normalize override row contract

```ts
type DealOverrideRow = {
  id: string
  deal_id: string
  decision_snapshot_id: string | null
  field_path: string
  old_value: unknown | null
  new_value: unknown | null
  reason: string | null
  justification: string | null
  severity: "info" | "warning" | "critical"
  requires_review: boolean
  created_at?: string
  updated_at?: string
}
```

Use in editor + audit fallback + override endpoints.

---

## New files

```text
src/components/journey/stageViews/_shared/useAdvisorSignalFeedback.ts
src/lib/journey/contracts/overrides.ts
src/components/journey/__tests__/spec09-advisor-feedback-patterns.test.ts
```

---

## Modified files

```text
src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx
src/lib/journey/advisor/buildCockpitAdvisorSignals.ts
src/lib/journey/advisor/buildAdvisorMemorySummary.ts

src/components/journey/stageViews/conditions/ConditionsInlineEditor.tsx
src/components/journey/stageViews/decision/OverrideInlineEditor.tsx

src/app/api/deals/[dealId]/conditions/route.ts
src/app/api/deals/[dealId]/conditions/list/route.ts
src/app/api/deals/[dealId]/overrides/route.ts
src/app/api/deals/[dealId]/overrides/[overrideId]/route.ts

src/components/journey/stageViews/decision/ApprovalConditionsPanel.tsx
src/components/journey/stageViews/decision/OverrideAuditPanel.tsx
src/components/journey/stageViews/closing/ClosingConditionsPanel.tsx

specs/banker-journey-fluidity/SPEC-09-advisor-feedback-patterns.md
```

---

## Acceptance tests

1. Signal keys are stable for the same deal and signal.
2. Dismissed signals are hidden.
3. Snoozed signals are hidden until expiry.
4. Expired snoozed signals reappear.
5. Acknowledged signals remain visible but move to Acknowledged group.
6. Acknowledged signals receive lower priority.
7. Advisor debug mode shows priority/confidence/rankReason/source/signalKey.
8. Advisor default mode hides debug metadata.
9. Signals render in grouped sections.
10. Critical signals render before Needs Attention.
11. `next_best_action` signals render under Suggested Actions.
12. `recent_change` signals render under Recent Activity.
13. `repeated_action_failure` emits `behavior_pattern_warning`.
14. `repeated_inline_undo` emits `behavior_pattern_warning`.
15. `stage_oscillation` emits `behavior_pattern_warning`.
16. `stale_blocker` emits `behavior_pattern_warning` when `createdAt` is older than 24h.
17. Pattern warning priority exceeds generic `recent_change`.
18. Pattern warning confidence remains deterministic.
19. Dismissed pattern warnings do not render.
20. Acknowledged pattern warnings render in Acknowledged.
21. `ConditionsInlineEditor` uses `DealConditionRow` contract.
22. `/conditions` and `/conditions/list` return `DealConditionRow`-compatible rows.
23. `items` alias is still present or explicitly removed with all consumers migrated.
24. `OverrideInlineEditor` uses `DealOverrideRow` contract.
25. Override endpoints return `DealOverrideRow`-compatible rows.
26. Advisor builder remains pure and does not fetch.
27. `CockpitAction` shape remains reused for advisor actions.
28. PrimaryActionBar still uses shared action execution.
29. StageBlockerList still uses shared action execution.
30. ForceAdvancePanel remains inside closed AdvancedDisclosure.
31. Existing SPEC-01..08 tests remain green.

---

## Recommended commits

```text
spec(journey): add advisor feedback and pattern contract
feat(journey): add advisor signal feedback state
feat(journey): add deterministic behavior pattern signals
feat(journey): group and debug advisor signals
feat(journey): normalize condition and override contracts
test(journey): cover SPEC-09 advisor feedback invariants
```

---

## PR title

```text
feat(journey): add advisor feedback and behavior patterns
```
