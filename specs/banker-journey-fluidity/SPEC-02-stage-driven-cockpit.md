# SPEC-02 — Stage-Driven Cockpit

**Path:** `specs/banker-journey-fluidity/SPEC-02-stage-driven-cockpit.md`
**Status:** Ready for implementation
**Owner:** Matt → Claude Code
**Branch:** off `main` (current: `feat/banker-analysis-alerts`)
**Depends on:** SPEC-01 (JourneyRail must be live)

---

## Problem

After SPEC-01, bankers have a JourneyRail that shows where the deal is.
But the cockpit body is still the legacy 3-column layout: Documents · Checklist · Readiness — with admin/advanced surfaces previously hosted by `SecondaryTabsPanel` (now removed in SPEC-01).

This means:

- The body is the same regardless of stage.
- Bankers see "everything, all the time" instead of "what matters now."
- Setup, story, intake review, underwriting controls, timeline, and admin tools are all crammed into the same surface.

---

## Goal

Make the cockpit body match the JourneyRail so the cockpit feels like one guided path — not a toolbox.

> JourneyRail shows where the deal is.
> Cockpit body shows exactly what matters for the current stage.

This PR is **SPEC-02 only**. SPEC-03 (committee studio uplift) and SPEC-04 (next_action_json canonicalization) are out of scope.

---

## Product Principle

```text
One stage at a time.
One primary action.
Every blocker comes with a plain-English fix path.
Advanced/admin tools are tucked behind a disclosure.
```

---

## Stage → cockpit body mapping

### 1. `intake_created` / `docs_requested` — IntakeStageView
Show:
- Start intake
- Invite borrower
- Upload documents
- Loan request status

### 2. `docs_in_progress` — DocumentsStageView (collecting variant)
Show:
- Document upload / review
- Missing docs
- AI classification progress
- Blocker list
- One primary action

### 3. `docs_satisfied` — DocumentsStageView (complete variant)
Show:
- Documents complete
- Checklist satisfied
- Ready to build financials
- Next action: proceed to underwriting / readiness

### 4. `underwrite_ready` — UnderwritingStageView (ready variant)
Show:
- Spreads status
- Financial snapshot status
- Model readiness
- Next action: start underwriting

### 5. `underwrite_in_progress` — UnderwritingStageView (in-progress variant)
Show:
- Spreads
- Banker analysis status card
- Risk result
- Memo generation status
- Next action: continue / retry / review

### 6. `committee_ready` — CommitteeStageView
Show:
- Credit memo
- Recommendation
- Reconciliation flags / conflicts
- Committee packet readiness
- Next action: review for decision

### 7. `committee_decisioned` — DecisionStageView
Show:
- Decision
- Conditions
- Approvals
- Next action: move to closing

### 8. `closing_in_progress` / `closed` — ClosingStageView
Show:
- Closing checklist
- Required docs
- Final status

### 9. `workout` — WorkoutStageView
Show:
- Special assets / workout surfaces

---

## Implementation rules

1. Replace the `SecondaryTabsPanel`-style cockpit body with a single `StageModeView` that switches on the current `LifecycleStage`.
2. Keep utility tabs only if needed: Documents, Financials, Risk, Relationship (already done in SPEC-01).
3. Advanced / admin tools go behind an `<Advanced>` disclosure.
4. Use `lifecycleState` from `CockpitDataContext` when available — do NOT call `useJourneyState` again inside the cockpit.
5. JourneyRail remains the navigation; cockpit body is now the stage workspace.
6. Show exactly one primary action at the top of the stage view (driven by `getNextAction`).
7. Every blocker should appear with a plain-English fix path (driven by `getBlockerFixAction`).
8. Do not delete old components yet; compose existing components into stage views.
9. No backend schema changes.
10. No lifecycle engine changes.

---

## In Scope

Create:

```text
src/components/journey/StageModeView.tsx
src/components/journey/stageViews/IntakeStageView.tsx
src/components/journey/stageViews/DocumentsStageView.tsx
src/components/journey/stageViews/UnderwritingStageView.tsx
src/components/journey/stageViews/CommitteeStageView.tsx
src/components/journey/stageViews/DecisionStageView.tsx
src/components/journey/stageViews/ClosingStageView.tsx
src/components/journey/stageViews/WorkoutStageView.tsx
src/components/journey/stageViews/_shared/StageWorkspaceShell.tsx
src/components/journey/stageViews/_shared/PrimaryActionBar.tsx
src/components/journey/stageViews/_shared/StageBlockerList.tsx
src/components/journey/stageViews/_shared/AdvancedDisclosure.tsx
src/components/journey/__tests__/StageModeView.test.ts
src/components/journey/__tests__/stageViews.test.ts
```

Modify:

```text
src/components/deals/DealCockpitClient.tsx
```

---

## Out of Scope

Do not:

- Rewrite the lifecycle engine
- Add or remove lifecycle stages
- Add new backend endpoints
- Delete old pages, routes, or components
- Implement SPEC-03 committee studio uplift
- Implement SPEC-04 next_action_json canonicalization
- Move admin tools (they live behind the disclosure for now)
- Change RLS, worker behavior, or schemas

---

## Architectural shape

Each stage view shares a common shell:

```text
+-------------------------------------------+
| RailHeader (already in JourneyRail)       |
+-------------------------------------------+
| [Primary Action Bar]                      |  <- ONE action button
+-------------------------------------------+
| [Stage-specific content panels]           |  <- composed from existing panels
+-------------------------------------------+
| [Blocker List with fix actions]           |  <- visible only if blockers exist
+-------------------------------------------+
| [Advanced disclosure]                     |  <- closed by default
+-------------------------------------------+
```

`StageModeView` switches on `state.stage` and routes to the right `*StageView`.

```ts
// pseudo:
function StageModeView({ dealId, isAdmin }) {
  const { lifecycleState } = useCockpitDataContext();
  const stage = lifecycleState?.stage ?? null;

  if (stage === "intake_created" || stage === "docs_requested") return <IntakeStageView ... />;
  if (stage === "docs_in_progress") return <DocumentsStageView dealId={dealId} variant="collecting" ... />;
  if (stage === "docs_satisfied") return <DocumentsStageView dealId={dealId} variant="complete" ... />;
  if (stage === "underwrite_ready") return <UnderwritingStageView dealId={dealId} variant="ready" ... />;
  if (stage === "underwrite_in_progress") return <UnderwritingStageView dealId={dealId} variant="in_progress" ... />;
  if (stage === "committee_ready") return <CommitteeStageView ... />;
  if (stage === "committee_decisioned") return <DecisionStageView ... />;
  if (stage === "closing_in_progress" || stage === "closed") return <ClosingStageView ... />;
  if (stage === "workout") return <WorkoutStageView ... />;
  return <IntakeStageView ... />;  // safe fallback
}
```

---

## Reuse existing components

Stage views compose the existing cockpit panels — do not rewrite them.
Exact wiring is at the implementer's discretion; the rule is *no new behavior*.

| Stage | Reuses |
|---|---|
| Intake | `DealIntakeCard`, `LoanRequestsSection`, `BorrowerAttachmentCard`, `BorrowerRequestComposerCard`, `BorrowerUploadLinksCard` |
| Documents | `LeftColumn` (CoreDocs/Pipeline), `CenterColumn` (Checklist/Pricing assumptions), `DocumentsTabPanel` |
| Underwriting | `RightColumn` (Readiness), `RiskDashboardPanel`, `UnderwritingControlPanel`, `DealOutputsPanel`, `PreviewUnderwritePanel`, `StoryPanel` (which already mounts `DealHealthPanel` + `BankerVoicePanel`) |
| Committee | `RightColumn` (Readiness primary CTA), summary card linking to `/committee-studio` and `/credit-memo` |
| Decision | `RightColumn` (Readiness primary CTA), summary card linking to `/decision` |
| Closing | `RightColumn` (Readiness), summary card linking to `/post-close` |
| Workout | Summary card linking to `/special-assets` |

Advanced disclosure (per stage that has admin tools) reveals:

- `ForceAdvancePanel` (admin only)
- `DealStoryTimeline`
- `IntakeReviewTable`
- Direct links to spreads, classic-spreads, sba-package, builder

---

## Tests (must pass)

Add to `src/components/journey/__tests__/`:

1. `StageModeView.test.ts` — current lifecycle stage selects the correct stage view (mapping table is exhaustive over `LifecycleStage`).
2. `stageViews.test.ts` — each stage view:
   - renders exactly one primary action at the top (single `<PrimaryActionBar />` element)
   - renders blockers with fix paths (via `getBlockerFixAction`)
   - keeps advanced tools hidden by default (closed `<details>`)
3. Existing `DealHealthPanel` / `BankerVoicePanel` placement invariant remains intact (they continue to be rendered through `StoryPanel`).
4. Cockpit uses `CockpitDataContext.lifecycleState`, NOT a duplicate `useJourneyState` call inside the cockpit body.

---

## Validation

```bash
pnpm test:unit
pnpm typecheck
pnpm lint
pnpm build
```

---

## Commit plan

Spec first:

```bash
git add specs/banker-journey-fluidity/SPEC-02-stage-driven-cockpit.md
git commit -m "spec(journey): add stage-driven cockpit contract"
```

Implementation:

```text
PR title:    feat(journey): make cockpit stage-driven
Commit msg:  feat(journey): SPEC-02 stage-driven cockpit body
```

---

## AAR Requirements

When complete, report:

- Files changed
- Stage mapping table (stage → which view → which existing components reused)
- Test results
- Screenshots if available
- Known follow-ups (e.g. components that should later be split, new endpoints SPEC-03 will need)

---

## Critical reminders

1. JourneyRail (SPEC-01) is the navigation; do not duplicate it inside the cockpit body.
2. Lifecycle engine is read-only from this PR's perspective.
3. Existing components are reused, not rewritten.
4. Exactly one primary action per stage view.
5. Blockers always carry a fix path.
6. Advanced/admin tools are hidden by default.
7. Do not delete old components or routes.
8. Do not call `useJourneyState` from within the cockpit body — read `lifecycleState` from `CockpitDataContext`.
