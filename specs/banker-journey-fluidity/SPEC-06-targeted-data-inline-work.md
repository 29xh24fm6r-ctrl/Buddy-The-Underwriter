# SPEC-06 — Targeted Data Lifting & Inline Work

**Path:** `specs/banker-journey-fluidity/SPEC-06-targeted-data-inline-work.md`
**Status:** Ready for implementation
**Owner:** Matt → Claude Code
**Branch:** off `main` (current: `feat/banker-analysis-alerts`)
**Depends on:** SPEC-01, SPEC-02, SPEC-03, SPEC-04, SPEC-05

---

## Goal

Reduce remount-based refresh debt and make the cockpit the primary place where bankers actually complete work.

SPEC-05 made stage data reactive, but Documents / Underwriting / Workout still rely on `key={refreshSeq}` remounts for heavy legacy panels. SPEC-06 should lift the highest-value data paths and introduce safe inline editing where it matters most.

---

## Primary objective

Move from:

```text
reactive stage shell + remount bridge
```

to:

```text
stage-owned data + inline edits + targeted refresh for critical workflows
```

---

## Scope

### 1. Lift DocumentsStageView data first

Target:

```text
DocumentsStageView
├─ document checklist data
├─ intake review data
├─ document readiness data
└─ borrower/upload request status
```

Create lightweight adapters rather than rewriting heavy panels.

New wrappers:

```text
src/components/journey/stageViews/documents/DocumentChecklistSurface.tsx
src/components/journey/stageViews/documents/IntakeReviewSurface.tsx
src/components/journey/stageViews/documents/UploadRequestSurface.tsx
```

These should:

* fetch through `useStageJsonResource`
* pass props to presentation components where possible
* fall back to existing panel only if needed

Avoid broad rewrites of `LeftColumn`.

---

### 2. Lift UnderwritingStageView selectively

Do **not** rewrite the whole underwriting workbench.

Target only:

```text
RiskDashboardPanel
StoryPanel / BankerVoice slice
UnderwritingControlPanel action state
```

New wrappers:

```text
src/components/journey/stageViews/underwriting/RiskSummarySurface.tsx
src/components/journey/stageViews/underwriting/BankerVoiceSurface.tsx
src/components/journey/stageViews/underwriting/UnderwritingActionsSurface.tsx
```

Goal:

* stop remounting the whole underwriting body for every action
* make banker-facing narrative refreshable
* preserve full legacy panels behind advanced disclosure if needed

---

### 3. Add inline condition editing in Decision / Closing

Create shared editor:

```text
src/components/journey/stageViews/conditions/ConditionsInlineEditor.tsx
```

Used by:

```text
DecisionStageView
ClosingStageView
```

Minimum inline actions:

```text
add condition
mark condition satisfied
mark condition waived
edit condition note
```

Use existing endpoints if available. If not, create thin route handlers:

```text
POST /api/deals/[dealId]/conditions/add
POST /api/deals/[dealId]/conditions/[conditionId]/status
PATCH /api/deals/[dealId]/conditions/[conditionId]
```

After mutation:

* optimistic update local condition list
* refresh `conditions` resource
* log cockpit action telemetry

---

### 4. Add inline override editing in DecisionStageView

Create:

```text
src/components/journey/stageViews/decision/OverrideInlineEditor.tsx
```

Minimum inline actions:

```text
add override
edit rationale
mark reviewed
```

Use existing override APIs if available; otherwise add thin handlers:

```text
POST /api/deals/[dealId]/overrides
PATCH /api/deals/[dealId]/overrides/[overrideId]
POST /api/deals/[dealId]/overrides/[overrideId]/review
```

Decision cockpit should become:

```text
DecisionStageView
├─ DecisionSummaryPanel
├─ ConditionsInlineEditor
├─ OverrideInlineEditor
├─ DecisionLetterPanel
├─ ReadinessPanel
└─ AdvancedDisclosure
```

---

### 5. Add scoped refresh API

Extend:

```text
src/components/journey/stageViews/_shared/StageDataProvider.tsx
src/components/journey/stageViews/_shared/useStageDataRefresh.ts
```

From:

```ts
refreshStageData(): Promise<void>
```

To:

```ts
refreshStageData(scope?: StageRefreshScope): Promise<void>
```

Scope type:

```ts
type StageRefreshScope =
  | "all"
  | "documents"
  | "underwriting"
  | "memo"
  | "decision"
  | "conditions"
  | "overrides"
  | "closing"
```

Refresher registration:

```ts
useRegisterStageRefresher("conditions", refreshConditions)
useRegisterStageRefresher("overrides", refreshOverrides)
```

Default:

```text
refreshStageData("all")
```

---

### 6. Add scoped optimistic updates

Extend `useStageJsonResource`:

```ts
setOptimisticData(updater)
refresh(scope)
```

For condition editor:

```text
mark condition satisfied
→ immediately update local row
→ refreshStageData("conditions")
```

For override editor:

```text
mark reviewed
→ immediately update local row
→ refreshStageData("overrides")
```

---

## New files

```text
src/components/journey/stageViews/documents/DocumentChecklistSurface.tsx
src/components/journey/stageViews/documents/IntakeReviewSurface.tsx
src/components/journey/stageViews/documents/UploadRequestSurface.tsx

src/components/journey/stageViews/underwriting/RiskSummarySurface.tsx
src/components/journey/stageViews/underwriting/BankerVoiceSurface.tsx
src/components/journey/stageViews/underwriting/UnderwritingActionsSurface.tsx

src/components/journey/stageViews/conditions/ConditionsInlineEditor.tsx
src/components/journey/stageViews/decision/OverrideInlineEditor.tsx

src/components/journey/__tests__/spec06-targeted-data-inline-work.test.ts
```

Optional backend files if existing APIs are insufficient:

```text
src/app/api/deals/[dealId]/conditions/add/route.ts
src/app/api/deals/[dealId]/conditions/[conditionId]/status/route.ts
src/app/api/deals/[dealId]/conditions/[conditionId]/route.ts

src/app/api/deals/[dealId]/overrides/route.ts
src/app/api/deals/[dealId]/overrides/[overrideId]/route.ts
src/app/api/deals/[dealId]/overrides/[overrideId]/review/route.ts
```

---

## Modified files

```text
src/components/journey/stageViews/DocumentsStageView.tsx
src/components/journey/stageViews/UnderwritingStageView.tsx
src/components/journey/stageViews/DecisionStageView.tsx
src/components/journey/stageViews/ClosingStageView.tsx

src/components/journey/stageViews/_shared/StageDataProvider.tsx
src/components/journey/stageViews/_shared/useStageDataRefresh.ts
src/components/journey/stageViews/_shared/useStageJsonResource.ts

src/components/journey/actions/logCockpitAction.ts
src/components/journey/actions/useCockpitAction.ts

src/components/journey/stageViews/decision/ApprovalConditionsPanel.tsx
src/components/journey/stageViews/closing/ClosingConditionsPanel.tsx

specs/banker-journey-fluidity/SPEC-06-targeted-data-inline-work.md
```

---

## Acceptance tests

1. DocumentsStageView no longer relies solely on key={refreshSeq} for document checklist refresh.
2. UnderwritingStageView no longer remounts the full underwriting body for every action.
3. ConditionsInlineEditor renders in DecisionStageView.
4. ConditionsInlineEditor renders in ClosingStageView.
5. Add condition performs optimistic insert before refresh completes.
6. Mark condition satisfied performs optimistic status update.
7. Mark condition waived performs optimistic status update.
8. Edit condition note performs optimistic note update.
9. Condition mutations refresh only scope="conditions".
10. OverrideInlineEditor renders in DecisionStageView.
11. Add override performs optimistic insert before refresh completes.
12. Edit override rationale performs optimistic update.
13. Mark override reviewed performs optimistic update.
14. Override mutations refresh only scope="overrides".
15. refreshStageData("conditions") calls only condition-scoped refreshers.
16. refreshStageData("all") calls all registered refreshers.
17. Unknown refresh scope is ignored safely or treated as all, but never crashes.
18. Inline mutation telemetry logs source="stage_cockpit".
19. Failed inline mutation shows inline error and reverts optimistic state.
20. PrimaryActionBar still uses shared action execution.
21. StageBlockerList still uses shared action execution.
22. ForceAdvancePanel remains inside closed AdvancedDisclosure.
23. Existing SPEC-01/02/03/04/05 tests remain green.

---

## Recommended commits

```text
spec(journey): add targeted data and inline work contract
feat(journey): add scoped stage refresh
feat(journey): lift documents stage data surfaces
feat(journey): lift underwriting summary surfaces
feat(journey): add inline condition editing
feat(journey): add inline override editing
test(journey): cover SPEC-06 inline work invariants
```

---

## PR title

```text
feat(journey): add inline cockpit work surfaces
```
