# SPEC-05 — Stage Data & Interaction Maturity

**Path:** `specs/banker-journey-fluidity/SPEC-05-stage-data-interaction-maturity.md`
**Status:** Ready for implementation
**Owner:** Matt → Claude Code
**Branch:** off `main` (current: `feat/banker-analysis-alerts`)
**Depends on:** SPEC-01, SPEC-02, SPEC-03, SPEC-04

---

## Goal

Make every cockpit stage reactive, consistent, and fast after SPEC-04 made actions executable.

SPEC-04 created the shared action runner, stage refresh context, telemetry, and first stage-owned data pattern in `CommitteeStageView`. SPEC-05 should extend that model across the full cockpit.

---

## Primary objective

Move from:

```text
panel-owned fetches + uneven refresh behavior
```

to:

```text
stage-owned data + registered refreshers + optimistic action feedback
```

---

## Scope

### 1. Expand `StageDataProvider` usage across every stage

Stages should register their own refreshers:

```text
DocumentsStageView
UnderwritingStageView
CommitteeStageView
DecisionStageView
ClosingStageView
WorkoutStageView
```

Pattern:

```text
StageView
├─ owns shared fetches
├─ passes data to panels
├─ registers refreshStageData()
└─ panels render props / call shared actions
```

---

### 2. Remove remaining panel-level data ownership where practical

Refactor panels that still fetch independently.

Target first:

```text
DocumentsStageView
├─ DocumentsTabPanel
├─ IntakeReviewTable
├─ ReadinessPanel

UnderwritingStageView
├─ RiskDashboardPanel
├─ StoryPanel
├─ UnderwritingControlPanel
├─ DealOutputsPanel
├─ PreviewUnderwritePanel

DecisionStageView
├─ DecisionSummaryPanel
├─ ApprovalConditionsPanel
├─ OverrideAuditPanel
├─ DecisionLetterPanel

ClosingStageView
├─ ClosingConditionsPanel
├─ PostCloseChecklistPanel
├─ ClosingDocsPanel
├─ ExceptionTrackerPanel
```

Do **not** rewrite business logic. Wrap/adapt existing data shapes.

---

### 3. Introduce a shared stage data hook

Create:

```text
src/components/journey/stageViews/_shared/useStageJsonResource.ts
```

Contract:

```ts
type StageJsonResource<T> = {
  data: T | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
  setOptimisticData: (updater: (current: T | null) => T | null) => void
}
```

Use this for stage-owned fetches.

---

### 4. Add minimal optimistic UI

After successful action:

```text
1. update visible status immediately
2. refresh canonical stage data
3. call router.refresh()
4. reconcile optimistic state with server state
```

Examples:

```text
generate_packet
→ immediately show "Packet generation started" / "Packet ready pending refresh"

send_reminder
→ immediately show "Reminder sent"

run_ai_classification
→ immediately show "Classification queued"

generate_snapshot
→ immediately show "Snapshot refresh requested"
```

No complex cache library yet.

---

### 5. Standardize action feedback UI

Create:

```text
src/components/journey/stageViews/_shared/ActionFeedback.tsx
```

Displays:

```text
pending
success
error
last action label
last refreshed timestamp
```

Use in:

```text
PrimaryActionBar
StageBlockerList
CommitteePackagePanel
```

Optionally expose at `StageWorkspaceShell` level later.

---

### 6. Harden `ACTION_ENDPOINT` contract

Modify:

```text
src/components/journey/actions/runCockpitAction.ts
```

Add:

```text
unknown actionType guard
per-action endpoint tests
structured error messages
```

Expected map:

```text
generate_packet        → /api/deals/[dealId]/committee/packet/generate
generate_snapshot      → /api/deals/[dealId]/financial-snapshot/recompute
run_ai_classification  → /api/deals/[dealId]/artifacts/process
send_reminder          → /api/deals/[dealId]/notifications/remind
```

---

### 7. Improve telemetry safety without blocking UX

Modify:

```text
src/components/journey/actions/logCockpitAction.ts
```

Keep fire-and-forget, but add:

```text
dev-only console.warn on failure
event payload validation
stage_data_refreshed event after successful refresh
```

Do **not** let telemetry failure break cockpit actions.

---

## New files

```text
src/components/journey/stageViews/_shared/useStageJsonResource.ts
src/components/journey/stageViews/_shared/ActionFeedback.tsx
src/components/journey/__tests__/spec05-stage-data-maturity.test.ts
```

---

## Modified files

```text
src/components/journey/stageViews/DocumentsStageView.tsx
src/components/journey/stageViews/UnderwritingStageView.tsx
src/components/journey/stageViews/DecisionStageView.tsx
src/components/journey/stageViews/ClosingStageView.tsx
src/components/journey/stageViews/WorkoutStageView.tsx

src/components/journey/stageViews/_shared/StageDataProvider.tsx
src/components/journey/stageViews/_shared/PrimaryActionBar.tsx
src/components/journey/stageViews/_shared/StageBlockerList.tsx
src/components/journey/stageViews/_shared/StatusListPanel.tsx

src/components/journey/actions/runCockpitAction.ts
src/components/journey/actions/useCockpitAction.ts
src/components/journey/actions/logCockpitAction.ts

specs/banker-journey-fluidity/SPEC-05-stage-data-interaction-maturity.md
```

---

## Acceptance tests

1. Every major stage registers at least one stage refresher when it owns client data.
2. Successful cockpit action invokes all registered stage refreshers.
3. router.refresh() still runs after stage refresh.
4. DecisionStageView owns decision/latest data instead of each panel fetching independently.
5. ClosingStageView owns conditions/post-close/exception data instead of each panel fetching independently.
6. CommitteeStageView keeps single memo readiness fetch from SPEC-04.
7. useStageJsonResource exposes loading, error, refresh, and optimistic update state.
8. generate_packet shows optimistic success feedback before canonical refresh completes.
9. send_reminder shows optimistic sent feedback.
10. run_ai_classification shows optimistic queued feedback.
11. generate_snapshot shows optimistic recompute feedback.
12. Unknown actionType returns structured error and does not call fetch.
13. Every ServerActionType has an explicit endpoint mapping test.
14. Telemetry failure does not fail the user action.
15. stage_data_refreshed telemetry is emitted after successful refresh.
16. PrimaryActionBar still renders one shared action surface.
17. StageBlockerList still routes blocker fixes through useCockpitAction.
18. ForceAdvancePanel remains inside closed AdvancedDisclosure.
19. Existing SPEC-01/02/03/04 journey tests remain green.

---

## Recommended commits

```text
spec(journey): add stage data maturity contract
feat(journey): add shared stage json resource hook
feat(journey): register refreshers across stage views
feat(journey): move decision and closing data ownership to stages
feat(journey): add optimistic cockpit action feedback
test(journey): cover SPEC-05 stage data invariants
```

---

## PR title

```text
feat(journey): make cockpit stage data reactive
```
