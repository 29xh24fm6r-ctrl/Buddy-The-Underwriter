# SPEC-03 — Committee Studio Uplift

**Path:** `specs/banker-journey-fluidity/SPEC-03-committee-studio-uplift.md`
**Status:** Ready for implementation
**Owner:** Matt → Claude Code
**Branch:** off `main` (current: `feat/banker-analysis-alerts`)
**Depends on:** SPEC-01, SPEC-02

---

## Goal

Turn post-underwriting stages from link hubs into true cockpit work surfaces.

Move `committee_ready`, `committee_decisioned`, and early closing prep into the stage-driven cockpit so bankers can review, reconcile, approve, condition, and hand off without leaving the cockpit.

---

## Scope

### 1. CommitteeStageView becomes real work surface

Replace current links card with embedded panels:

```text
CommitteeStageView
├─ CreditMemoPanel
├─ MemoReconciliationPanel
├─ CommitteePackagePanel
├─ ApprovalReadinessPanel
├─ ReadinessPanel
└─ AdvancedDisclosure
```

Core jobs:

* show current credit memo
* show gaps between extracted data, underwriting outputs, and memo language
* surface approval blockers
* allow regenerate / refresh memo package
* prepare committee packet

---

### 2. DecisionStageView becomes audit + approval surface

Replace links with:

```text
DecisionStageView
├─ DecisionSummaryPanel
├─ ApprovalConditionsPanel
├─ OverrideAuditPanel
├─ DecisionLetterPanel
├─ ReadinessPanel
└─ AdvancedDisclosure
```

Core jobs:

* display decision status
* show approved / declined / needs-more-info
* expose overrides and rationale
* track approval conditions
* generate borrower-facing decision artifacts

---

### 3. ClosingStageView gets conditions-first cockpit

Replace minimal links with:

```text
ClosingStageView
├─ ClosingConditionsPanel
├─ PostCloseChecklistPanel
├─ ClosingDocsPanel
├─ ExceptionTrackerPanel
├─ ReadinessPanel
└─ AdvancedDisclosure
```

Core jobs:

* track pre-close and post-close conditions
* show missing closing docs
* surface exceptions
* keep lifecycle movement grounded in readiness

---

## New files

```text
src/components/journey/stageViews/committee/CreditMemoPanel.tsx
src/components/journey/stageViews/committee/MemoReconciliationPanel.tsx
src/components/journey/stageViews/committee/CommitteePackagePanel.tsx
src/components/journey/stageViews/committee/ApprovalReadinessPanel.tsx

src/components/journey/stageViews/decision/DecisionSummaryPanel.tsx
src/components/journey/stageViews/decision/ApprovalConditionsPanel.tsx
src/components/journey/stageViews/decision/OverrideAuditPanel.tsx
src/components/journey/stageViews/decision/DecisionLetterPanel.tsx

src/components/journey/stageViews/closing/ClosingConditionsPanel.tsx
src/components/journey/stageViews/closing/PostCloseChecklistPanel.tsx
src/components/journey/stageViews/closing/ClosingDocsPanel.tsx
src/components/journey/stageViews/closing/ExceptionTrackerPanel.tsx

src/components/journey/tests/spec03-committee-studio.test.ts
```

---

## Modified files

```text
src/components/journey/stageViews/CommitteeStageView.tsx
src/components/journey/stageViews/DecisionStageView.tsx
src/components/journey/stageViews/ClosingStageView.tsx
src/components/journey/stageViews/_shared/PrimaryActionBar.tsx
src/components/journey/stageViews/_shared/StageWorkspaceShell.tsx
specs/banker-journey-fluidity/SPEC-03-committee-studio-uplift.md
```

---

## Must preserve from SPEC-02

* `StageModeView` remains the lifecycle discriminator.
* `DealCockpitClient` must not reintroduce direct `LeftColumn`, `CenterColumn`, or `RightColumn`.
* One `PrimaryActionBar` per stage render path.
* `ForceAdvancePanel` remains admin-only inside closed-by-default `AdvancedDisclosure`.
* Lifecycle state remains read from `CockpitDataContext`, not `useJourneyState`.
* Existing SPEC-01 + SPEC-02 tests must remain green.

---

## SPEC-03 acceptance tests

1. CommitteeStageView renders embedded memo surface, not route-only links.
2. CommitteeStageView includes reconciliation between source docs, underwriting outputs, and memo fields.
3. DecisionStageView renders approval conditions inline.
4. DecisionStageView renders override audit trail inline.
5. ClosingStageView renders conditions tracker inline.
6. ClosingStageView renders exception tracker inline.
7. No stage view renders more than one PrimaryActionBar.
8. ForceAdvancePanel remains nested inside AdvancedDisclosure.
9. AdvancedDisclosure remains closed by default.
10. DealCockpitClient still delegates stage body to StageModeView.
11. Runnable actions are displayed but may still degrade safely if SPEC-04 owns execution.
12. All existing journey tests remain passing.

---

## Recommended commits

```text
spec(journey): add committee studio uplift contract
feat(journey): embed committee memo and reconciliation surfaces
feat(journey): embed decision and closing work surfaces
test(journey): cover SPEC-03 stage work-surface invariants
```

---

## PR title

```text
feat(journey): make committee decision and closing stages cockpit-native
```
