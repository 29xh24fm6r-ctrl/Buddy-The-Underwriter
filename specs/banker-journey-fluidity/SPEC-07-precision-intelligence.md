# SPEC-07 — Precision Refresh, Contract Normalization & Cockpit Intelligence

**Path:** `specs/banker-journey-fluidity/SPEC-07-precision-intelligence.md`
**Status:** Ready for implementation
**Owner:** Matt → Claude Code
**Branch:** off `main` (current: `feat/banker-analysis-alerts`)
**Depends on:** SPEC-01..06

---

## Goal

Tighten the cockpit after SPEC-06 by reducing unnecessary refreshes, normalizing data contracts, improving optimistic UX, and introducing the first deterministic intelligence layer. SPEC-06 made inline cockpit work real; SPEC-07 should make it precise and advisory.

---

## Primary objective

Move from:

```text
inline work + scoped refresh + optimistic mutations
```

to:

```text
precise refresh + normalized contracts + lightweight undo + trusted advisor signals
```

---

## Scope

### 1. Tighten scoped refresh behavior

Current issue:

```text
refreshStageData("conditions")
→ conditions + all bucket
```

SPEC-07 should make scopes strict by default.

```ts
refreshStageData("conditions") → conditions refreshers only
refreshStageData("all")        → every refresher
refreshStageData(undefined)    → all
refreshStageData("conditions", { includeGlobal: true })
                               → conditions + all bucket (opt-in)
```

---

### 2. Normalize conditions API response shape

Current drift:

```text
/conditions      → { conditions: [...] }
/conditions/list → { items: [...] }
```

Standardize on `{ conditions: DealCondition[] }`. Add contract tests so endpoint drift fails loudly. Keep `items` as a deprecated alias on `/conditions/list` for one cycle.

---

### 3. Add lightweight undo for inline mutations

```text
optimistic update
→ show "Undo" affordance for 6–10 seconds
→ if clicked, call compensating mutation where available
→ refresh affected scope
→ log telemetry
```

**Supported undo targets:**

```text
condition status change
condition note edit
override rationale edit
override reviewed toggle
```

**Not supported** (no delete endpoint yet):

```text
new condition insert
new override insert
```

---

### 4. Reduce optimistic refresh flicker

```text
optimistic update
→ await server
→ if server returned canonical entity, merge it
→ delay background refresh briefly
→ only hard refresh if canonical mismatch or no server payload
```

Add `reconcileOptimisticData(serverResult)` to inline mutation flow.

---

### 5. Add cockpit intelligence summary panel

`CockpitAdvisorPanel` — deterministic first, AI later.

**Initial advisor outputs:**

```text
next best action
why this deal is blocked
recent meaningful changes
risk / readiness warning
```

Rules-driven and testable.

---

### 6. Add advisor signal builder

```ts
type CockpitAdvisorSignal = {
  kind:
    | "next_best_action"
    | "blocked_reason"
    | "recent_change"
    | "readiness_warning"
    | "risk_warning"
  severity: "info" | "warning" | "critical"
  title: string
  detail: string
  action?: CockpitAction
  source: "lifecycle" | "blockers" | "conditions" | "overrides" | "memo" | "documents" | "telemetry"
}
```

Pure and heavily tested.

---

## New files

```text
src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx
src/lib/journey/advisor/buildCockpitAdvisorSignals.ts
src/components/journey/__tests__/spec07-precision-intelligence.test.ts
```

Optional:

```text
src/components/journey/actions/useUndoableInlineMutation.ts
```

---

## Modified files

```text
src/components/journey/stageViews/_shared/StageDataProvider.tsx
src/components/journey/stageViews/_shared/useStageDataRefresh.ts
src/components/journey/stageViews/_shared/useStageJsonResource.ts

src/components/journey/actions/useInlineMutation.ts
src/components/journey/actions/logCockpitAction.ts

src/components/journey/stageViews/conditions/ConditionsInlineEditor.tsx
src/components/journey/stageViews/decision/OverrideInlineEditor.tsx

src/components/journey/stageViews/DocumentsStageView.tsx
src/components/journey/stageViews/UnderwritingStageView.tsx
src/components/journey/stageViews/CommitteeStageView.tsx
src/components/journey/stageViews/DecisionStageView.tsx
src/components/journey/stageViews/ClosingStageView.tsx

src/app/api/deals/[dealId]/conditions/route.ts
src/app/api/deals/[dealId]/conditions/list/route.ts

specs/banker-journey-fluidity/SPEC-07-precision-intelligence.md
```

---

## Acceptance tests

1. `refreshStageData("conditions")` calls only condition-scoped refreshers.
2. `refreshStageData("overrides")` calls only override-scoped refreshers.
3. `refreshStageData("all")` calls every registered refresher.
4. Unknown scope falls back safely without crashing.
5. `/conditions` and `/conditions/list` return the same response shape.
6. `ConditionsInlineEditor` consumes normalized `{ conditions }` shape.
7. Condition status mutation shows undo affordance.
8. Undo condition status mutation calls compensating mutation.
9. Condition note edit shows undo affordance.
10. Override rationale edit shows undo affordance.
11. Override reviewed mutation shows undo affordance.
12. New condition insert does not show undo unless delete endpoint exists.
13. Successful optimistic mutation merges server result without immediate flicker.
14. Hard refresh runs only when server result is missing or mismatched.
15. Inline mutation telemetry includes undo events.
16. `CockpitAdvisorPanel` renders in all major stage views.
17. Advisor signal builder emits `next_best_action` from lifecycle action.
18. Advisor signal builder emits `blocked_reason` from blockers.
19. Advisor signal builder emits `readiness_warning` from low document readiness.
20. Advisor signal builder emits `risk_warning` from unresolved overrides or critical conditions.
21. Advisor signal builder emits `recent_change` from recent cockpit telemetry.
22. Advisor signal builder is pure and does not call fetch.
23. Advisor actions reuse `CockpitAction` shape.
24. PrimaryActionBar still uses shared action execution.
25. StageBlockerList still uses shared action execution.
26. ForceAdvancePanel remains inside closed AdvancedDisclosure.
27. Existing SPEC-01/02/03/04/05/06 journey tests remain green.

---

## Recommended commits

```text
spec(journey): add precision and advisor contract
feat(journey): tighten scoped stage refresh
feat(journey): normalize conditions contracts
feat(journey): add undoable inline mutations
feat(journey): add deterministic cockpit advisor signals
feat(journey): render advisor panel across stages
test(journey): cover SPEC-07 precision and intelligence invariants
```

---

## PR title

```text
feat(journey): add precise refresh and cockpit advisor signals
```
