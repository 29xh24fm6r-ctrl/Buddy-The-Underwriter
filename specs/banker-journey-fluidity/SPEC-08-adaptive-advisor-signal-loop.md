# SPEC-08 — Adaptive Advisor Signal Loop

**Path:** `specs/banker-journey-fluidity/SPEC-08-adaptive-advisor-signal-loop.md`
**Status:** Ready for implementation
**Owner:** Matt → Claude Code
**Branch:** off `main` (current: `feat/banker-analysis-alerts`)
**Depends on:** SPEC-01..07

---

## Goal

Make the deterministic advisor live, ranked, confidence-aware, and grounded in real cockpit telemetry without making it black-box or LLM-dependent.

SPEC-07 introduced strict refresh, undo, reconciliation, and the first pure advisor signal builder. SPEC-08 should now feed it real events and turn signals into prioritized guidance.

---

## Primary objective

Move from:

```text
static deterministic advisor signals
```

to:

```text
live telemetry-fed advisor with ranking, confidence, and richer reconciliation
```

---

## Scope

### 1. Feed live telemetry into `CockpitAdvisorPanel`

Create:

```text
src/components/journey/stageViews/_shared/useRecentCockpitTelemetry.ts
```

Fetch from existing ledger source. If a `/api/buddy/signals/recent` endpoint doesn't exist, the existing `/api/buddy/signals/latest` (already filters by `dealId`, paginates by `limit`) covers the same semantics. Pre-filter in the hook for these event families:

```text
cockpit_action_*
blocker_fix_*
cockpit_inline_mutation_*
stage_data_refreshed
```

Then pass into `<CockpitAdvisorPanel recentTelemetry={recentTelemetry} />`.

---

### 2. Add advisor signal ranking

Extend `CockpitAdvisorSignal`:

```ts
priority: number
rankReason: string
```

Ranking rules (high → low):

```text
critical blocker > failed recent mutation > readiness warning > risk warning > next best action > recent change
```

Tie-breakers: severity → recency → actionability → stage relevance.

---

### 3. Add confidence score

```ts
confidence: number // 0–1
```

Suggested confidence:

```text
lifecycle blocker      0.95
readiness metric       0.9
condition/override     0.85
recent telemetry       0.75
derived inference      0.65
```

Deterministic, not AI-generated.

---

### 4. Add advisor memory summary

```ts
type AdvisorMemorySummary = {
  lastActionAt?: string
  lastActionLabel?: string
  lastMutationAt?: string
  lastMutationSummary?: string
  lastUndoAt?: string
  recentlyResolvedBlockers: number
  recentFailures: number
}
```

Render as a compact "Recent activity" section inside the advisor panel.

---

### 5. Expand reconciliation coverage

Update endpoints to return canonical rows:

```text
POST /api/deals/[dealId]/conditions/set-status      → returns the updated condition
POST /api/deals/[dealId]/overrides/[overrideId]/review → returns the updated override
```

Then update `ConditionsInlineEditor`, `OverrideInlineEditor`, and the inline mutation runner so these mutations can reconcile without hard refresh.

---

### 6. Normalize condition row shape fully

SPEC-07 normalized the response key but not the row shape. Add a shared contract type and use it across all consumers.

```ts
type DealConditionRow = {
  id: string
  deal_id: string
  title: string
  description: string | null
  category: string | null
  status: "open" | "satisfied" | "waived"
  due_date: string | null
  severity?: "info" | "warning" | "critical"
  linked_doc_count?: number
  linked_evidence?: unknown[]
  updated_at?: string
}
```

---

### 7. Advisor refresh after mutations

After successful action or inline mutation:

```text
refreshStageData(scope)
refresh advisor telemetry
rebuild signals
```

Do **not** block the mutation on advisor refresh.

---

## New files

```text
src/components/journey/stageViews/_shared/useRecentCockpitTelemetry.ts
src/lib/journey/advisor/buildAdvisorMemorySummary.ts
src/lib/journey/contracts/conditions.ts
src/components/journey/__tests__/spec08-adaptive-advisor-loop.test.ts
```

Optional:

```text
src/app/api/buddy/signals/recent/route.ts
```

---

## Modified files

```text
src/components/journey/stageViews/_shared/CockpitAdvisorPanel.tsx

src/lib/journey/advisor/buildCockpitAdvisorSignals.ts

src/components/journey/stageViews/conditions/ConditionsInlineEditor.tsx
src/components/journey/stageViews/decision/OverrideInlineEditor.tsx
src/components/journey/actions/useInlineMutation.ts

src/app/api/deals/[dealId]/conditions/route.ts
src/app/api/deals/[dealId]/conditions/list/route.ts
src/app/api/deals/[dealId]/conditions/set-status/route.ts
src/app/api/deals/[dealId]/overrides/[overrideId]/review/route.ts

specs/banker-journey-fluidity/SPEC-08-adaptive-advisor-signal-loop.md
```

---

## Acceptance tests

1. `CockpitAdvisorPanel` fetches recent cockpit telemetry for the active deal.
2. Advisor ignores unrelated deal telemetry.
3. Advisor ignores non-cockpit signal families.
4. Advisor memory summary detects last action.
5. Advisor memory summary detects last inline mutation.
6. Advisor memory summary detects last undo.
7. Advisor memory summary counts recent failures.
8. Advisor signal builder assigns priority to every signal.
9. Critical blockers rank above readiness warnings.
10. Failed recent mutations rank above generic recent changes.
11. Signals include deterministic confidence.
12. Lifecycle blocker confidence is higher than telemetry-only confidence.
13. Advisor signals remain pure and do not fetch.
14. Advisor actions still use `CockpitAction` shape.
15. Condition status mutation reconciles from canonical server row.
16. Override reviewed mutation reconciles from canonical server row.
17. No hard refresh occurs when reconcile succeeds.
18. Hard refresh still occurs when reconcile fails or server row is missing.
19. `/conditions` and `/conditions/list` return the same canonical row shape.
20. `ConditionsInlineEditor` consumes `DealConditionRow` contract.
21. Advisor telemetry refresh runs after successful cockpit action.
22. Advisor telemetry refresh runs after successful inline mutation.
23. Advisor telemetry refresh failure does not fail user action.
24. Undo telemetry appears in recent activity.
25. PrimaryActionBar still uses shared action execution.
26. StageBlockerList still uses shared action execution.
27. ForceAdvancePanel remains inside closed AdvancedDisclosure.
28. Existing SPEC-01..07 tests remain green.

---

## Recommended commits

```text
spec(journey): add adaptive advisor signal loop contract
feat(journey): feed live cockpit telemetry to advisor
feat(journey): add advisor ranking and confidence
feat(journey): add advisor memory summary
feat(journey): normalize condition row contracts
feat(journey): reconcile status and review mutations
test(journey): cover SPEC-08 adaptive advisor invariants
```

---

## PR title

```text
feat(journey): make cockpit advisor telemetry-aware
```
