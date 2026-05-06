# SPEC-04 — Cockpit Action Execution Layer

**Path:** `specs/banker-journey-fluidity/SPEC-04-cockpit-action-execution.md`
**Status:** Ready for implementation
**Owner:** Matt → Claude Code
**Branch:** off `main` (current: `feat/banker-analysis-alerts`)
**Depends on:** SPEC-01, SPEC-02, SPEC-03

---

## Goal

Turn the stage-driven cockpit from a guided UI into an executable operating surface.

SPEC-03 made committee, decision, and closing cockpit-native. SPEC-04 should now make cockpit actions actually run, refresh, and log instead of degrading to links.

---

## Primary objective

Unify all cockpit actions behind one execution contract:

```text
PrimaryActionBar
├─ navigate actions
├─ runnable server actions
├─ blocker fix actions
└─ post-action refresh / telemetry
```

---

## Scope

### 1. Add action execution contract

Create:

```text
src/components/journey/actions/actionTypes.ts
src/components/journey/actions/runCockpitAction.ts
src/components/journey/actions/useCockpitAction.ts
```

Action model:

```ts
type CockpitAction =
  | {
      intent: "navigate"
      label: string
      href: string
    }
  | {
      intent: "runnable"
      label: string
      actionType: ServerActionType
      payload?: Record<string, unknown>
    }
  | {
      intent: "fix_blocker"
      label: string
      blockerId: string
      actionType: ServerActionType
      payload?: Record<string, unknown>
    }
```

Supported `ServerActionType`:

```text
generate_snapshot
generate_packet
run_ai_classification
send_reminder
```

---

### 2. PrimaryActionBar executes actions

Modify:

```text
src/components/journey/stageViews/_shared/PrimaryActionBar.tsx
```

Behavior:

```text
navigate        → router.push(href)
runnable        → POST existing server endpoint
fix_blocker     → POST existing fix-action endpoint
success         → refresh stage data + router.refresh()
failure         → show inline error
pending         → disable button + show loading state
```

No stage view should call action endpoints directly unless the action is truly panel-local.

---

### 3. Move CommitteePackagePanel packet generation into shared action system

Currently `CommitteePackagePanel` directly invokes:

```text
POST /committee/packet/generate
```

SPEC-04 should replace that with:

```text
intent: "runnable"
actionType: "generate_packet"
```

That removes split-brain behavior:

* panel actions
* primary actions
* blocker fix actions

All should flow through the same executor.

---

### 4. Add stage-level refresh / mutation model

Create:

```text
src/components/journey/stageViews/_shared/StageDataProvider.tsx
src/components/journey/stageViews/_shared/useStageDataRefresh.ts
```

Minimum behavior:

```ts
type StageDataRefreshContext = {
  refreshStageData: () => Promise<void>
}
```

After successful cockpit action:

```text
1. call refreshStageData()
2. call router.refresh()
3. clear stale errors
4. update visible panel state
```

This can be simple. No need for React Query yet.

---

### 5. Lift duplicated memo fetch in CommitteeStageView

Modify:

```text
src/components/journey/stageViews/CommitteeStageView.tsx
src/components/journey/stageViews/committee/CreditMemoPanel.tsx
src/components/journey/stageViews/committee/MemoReconciliationPanel.tsx
```

Before:

```text
CreditMemoPanel fetches /credit-memo/canonical/missing
MemoReconciliationPanel fetches /credit-memo/canonical/missing
```

After:

```text
CommitteeStageView fetches once
├─ CreditMemoPanel memoSummary={memoSummary}
└─ MemoReconciliationPanel memoSummary={memoSummary}
```

This establishes the pattern:

```text
stage owns shared data
panels render data
actions mutate data
stage refreshes data
```

---

### 6. Add telemetry hook to canonical ledger

Create:

```text
src/components/journey/actions/logCockpitAction.ts
```

Minimum event types:

```text
cockpit_action_started
cockpit_action_succeeded
cockpit_action_failed
blocker_fix_started
blocker_fix_succeeded
blocker_fix_failed
stage_data_refreshed
```

Each event should include:

```ts
{
  dealId,
  lifecycleStage,
  actionType,
  intent,
  blockerId?,
  resultStatus,
  errorMessage?,
  source: "stage_cockpit"
}
```

Use Buddy's canonical ledger pattern rather than creating a new bespoke action-log table.

---

## New files

```text
src/components/journey/actions/actionTypes.ts
src/components/journey/actions/runCockpitAction.ts
src/components/journey/actions/useCockpitAction.ts
src/components/journey/actions/logCockpitAction.ts

src/components/journey/stageViews/_shared/StageDataProvider.tsx
src/components/journey/stageViews/_shared/useStageDataRefresh.ts

src/components/journey/__tests__/spec04-action-execution.test.ts
```

---

## Modified files

```text
src/components/journey/stageViews/_shared/PrimaryActionBar.tsx
src/components/journey/stageViews/_shared/StageWorkspaceShell.tsx

src/components/journey/stageViews/CommitteeStageView.tsx
src/components/journey/stageViews/committee/CreditMemoPanel.tsx
src/components/journey/stageViews/committee/MemoReconciliationPanel.tsx
src/components/journey/stageViews/committee/CommitteePackagePanel.tsx

src/lib/journey/getNextAction.ts
src/lib/journey/getBlockerFixAction.ts

specs/banker-journey-fluidity/SPEC-04-cockpit-action-execution.md
```

---

## Acceptance tests

1. PrimaryActionBar navigates for intent=navigate.
2. PrimaryActionBar does not call fetch for navigate actions.
3. PrimaryActionBar POSTs for intent=runnable.
4. PrimaryActionBar POSTs for intent=fix_blocker.
5. Pending action disables the active button.
6. Successful action calls refreshStageData().
7. Successful action calls router.refresh().
8. Failed action renders inline error.
9. generate_packet is executed through shared action system, not directly in CommitteePackagePanel.
10. CommitteeStageView fetches memo readiness once and passes it to both memo panels.
11. CreditMemoPanel no longer independently fetches memo readiness.
12. MemoReconciliationPanel no longer independently fetches memo readiness.
13. Action telemetry logs started/succeeded/failed events.
14. Blocker fix telemetry logs started/succeeded/failed events.
15. No stage renders more than one PrimaryActionBar.
16. ForceAdvancePanel remains inside closed AdvancedDisclosure.
17. Existing SPEC-01/02/03 journey tests remain green.

---

## Recommended commits

```text
spec(journey): add cockpit action execution contract
feat(journey): execute primary cockpit actions
feat(journey): add stage refresh context
feat(journey): lift committee memo data to stage level
feat(journey): log cockpit action telemetry
test(journey): cover SPEC-04 action execution invariants
```

---

## PR title

```text
feat(journey): make cockpit actions executable
```
