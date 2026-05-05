# SPEC-01 — Banker Journey Rail

**Path:** `specs/banker-journey-fluidity/SPEC-01-journey-rail.md`  
**Status:** Ready for Claude Code  
**Owner:** Matt (architecture) → Claude Code (implementation)  
**Branch:** `main`  
**Depends on:** `src/buddy/lifecycle/*`  

---

## Problem

Buddy has strong lifecycle infrastructure, but the banker UI does not surface it as one clear journey.

A banker landing on a deal sees too many navigation concepts at once:

- DealShell tabs
- cockpit panels
- setup/documents/underwriting tabs
- admin controls
- separate links to spreads, memo, committee, and decision

The result is that bankers do not have a clear answer to:

```text
Where am I?
What is done?
What is blocked?
What should I do next?
```

The system should feel like one guided path from intake to committee decision.

---

## Goal

Create a persistent **JourneyRail** that makes the banker path obvious and canonical.

The rail should show:

1. all lifecycle stages
2. current stage
3. completed stages
4. next stage
5. locked stages
6. blockers
7. exactly one current next action

This PR is **SPEC-01 only**.

It should make the journey visible and navigable.

It should **not** collapse the cockpit body yet. That happens in SPEC-02.

---

## Product Principle

Buddy should stop feeling like a toolbox and start feeling like a guided deal journey.

```text
One journey.
One current state.
One next action.
Supporting tools stay available, but they no longer define the experience.
```

---

## In Scope

Create:

```text
src/components/journey/JourneyRail.tsx
src/components/journey/JourneyMiniRail.tsx
src/components/journey/StageRow.tsx
src/components/journey/RailHeader.tsx
src/components/journey/stageRoutes.ts
src/buddy/lifecycle/blockerToStage.ts
src/hooks/useJourneyState.ts
src/components/journey/__tests__/JourneyRail.test.tsx
src/components/journey/__tests__/JourneyMiniRail.test.tsx
src/components/journey/__tests__/blockerToStage.test.ts
e2e/journey-rail.spec.ts
```

Modify:

```text
src/app/(app)/deals/[dealId]/layout.tsx
src/app/(app)/deals/[dealId]/DealShell.tsx
src/app/(app)/deals/page.tsx
src/components/deals/DealCockpitClient.tsx
```

---

## Out of Scope

Do not:

* rewrite the lifecycle engine
* add a new state machine
* change lifecycle stage ordering
* add new backend lifecycle endpoints
* delete old pages/routes
* implement SPEC-02 cockpit collapse
* implement SPEC-03 committee studio uplift
* implement SPEC-04 next_action_json canonicalization
* move admin tools
* change RLS
* change worker behavior

---

## Pre-Implementation Verification

Before coding, read these files fresh and confirm their real exports/shapes:

```text
src/buddy/lifecycle/model.ts
src/buddy/lifecycle/nextAction.ts
src/app/api/deals/[dealId]/lifecycle/route.ts
src/buddy/cockpit/useCockpitData.ts
```

Verify:

1. `model.ts` exports lifecycle stages, labels, allowed transitions, lifecycle types, and blocker code types.
2. `nextAction.ts` exports `getNextAction(...)`.
3. Lifecycle API returns `{ ok, state }`.
4. Cockpit data context exposes lifecycle state or enough state to avoid duplicate fetches.
5. If any of these assumptions are wrong, stop and report the mismatch before implementing.

Do not invent replacements.

---

## Canonical Lifecycle Stages

Use the actual lifecycle stages from `src/buddy/lifecycle/model.ts`.

Expected canonical flow:

```text
1. intake_created
2. docs_requested
3. docs_in_progress
4. docs_satisfied
5. underwrite_ready
6. underwrite_in_progress
7. committee_ready
8. committee_decisioned
9. closing_in_progress
10. closed
11. workout
```

If the actual lifecycle module differs, follow the module and document the delta in the AAR.

Display labels must come from lifecycle labels if available. Do not hand-type labels if `STAGE_LABELS` exists.

---

## JourneyRail

Create:

```text
src/components/journey/JourneyRail.tsx
```

### Props

```ts
import type { LifecycleState, LifecycleStage } from "@/buddy/lifecycle/model";

type JourneyRailProps = {
  dealId: string;
  initialState?: LifecycleState | null;
  variant?: "vertical" | "horizontal";
  className?: string;
};

export function JourneyRail(props: JourneyRailProps): JSX.Element;
```

### Desktop layout

Desktop rail should be persistent on the left side.

Width target:

```text
260px
```

It should show:

```text
Deal name / summary if available
Lifecycle stage list
Current stage
One next action
Blockers
```

### Mobile layout

Below the large breakpoint, collapse into a compact horizontal rail at the top of the page.

Do not break mobile layout.

---

## Stage Status Derivation

Derive status in the component from lifecycle state.

```ts
type StageStatus =
  | "complete"
  | "current"
  | "next"
  | "locked"
  | "skipped";
```

Rules:

```ts
complete = stage index < current stage index
current = stage index === current stage index
next = stage index === current stage index + 1 && no blockers
locked = future stage that is not next, or future stage blocked by current blockers
skipped = workout branch when deal is not on workout path
```

Workout:

```text
If current stage is workout:
  workout = current
  normal linear path remains visible but dimmed

If current stage is not workout:
  workout = skipped/off-path
```

Unknown stage:

```text
Do not crash.
Render a safe fallback and log dev-only warning.
```

---

## Current Stage Action

Only the current stage may show an action button.

Use:

```ts
getNextAction(state, dealId)
```

Supported intent behavior:

```text
navigate:
  render Link to href

advance:
  POST /api/deals/[dealId]/lifecycle/advance

runnable:
  POST /api/deals/[dealId]/lifecycle/action
  only if existing endpoint supports the action

blocked:
  show blocker chip instead of button
```

If a runnable action is not supported by existing lifecycle action route, do not add a new endpoint in this PR. Render it as a navigate action to the closest existing page and document the mismatch.

---

## Blockers

Create:

```text
src/buddy/lifecycle/blockerToStage.ts
```

Export:

```ts
import type { LifecycleBlockerCode, LifecycleStage } from "./model";

export function blockerGatesStage(
  code: LifecycleBlockerCode
): LifecycleStage | null;
```

Map blocker codes to the stage they gate.

Use actual blocker code union from `model.ts`.

Expected mapping, if these codes exist:

```ts
export function blockerGatesStage(code: LifecycleBlockerCode): LifecycleStage | null {
  switch (code) {
    case "checklist_not_seeded":
    case "borrower_not_attached":
    case "loan_request_missing":
    case "loan_request_incomplete":
      return "docs_requested";

    case "intake_health_below_threshold":
    case "intake_confirmation_required":
      return "docs_in_progress";

    case "gatekeeper_docs_incomplete":
    case "gatekeeper_docs_need_review":
    case "artifacts_processing_stalled":
      return "docs_satisfied";

    case "pricing_assumptions_required":
    case "structural_pricing_missing":
    case "spreads_incomplete":
    case "financial_snapshot_missing":
    case "financial_snapshot_stale":
    case "financial_snapshot_build_failed":
    case "financial_validation_open":
      return "underwrite_ready";

    case "underwrite_not_started":
    case "underwrite_incomplete":
    case "critical_flags_unresolved":
      return "underwrite_in_progress";

    case "committee_packet_missing":
      return "committee_ready";

    case "decision_missing":
    case "policy_exceptions_unresolved":
      return "committee_decisioned";

    case "attestation_missing":
    case "closing_docs_missing":
    case "pricing_quote_missing":
    case "risk_pricing_not_finalized":
      return "closing_in_progress";

    case "deal_not_found":
    case "schema_mismatch":
    case "internal_error":
    case "data_fetch_failed":
    case "checklist_fetch_failed":
    case "snapshot_fetch_failed":
    case "decision_fetch_failed":
    case "attestation_fetch_failed":
    case "packet_fetch_failed":
    case "advancement_fetch_failed":
    case "readiness_fetch_failed":
      return null;

    default:
      return null;
  }
}
```

If actual blocker codes differ, update this mapping to match the real union.

### Blocker display rules

* Stage-specific blockers display inline on the locked stage row.
* Infrastructure blockers (`null` mapping) display as a rail-level banner.
* Locked stage rows do not navigate.
* Clicking blocker text expands details and shows any available fix action.

If `getBlockerFixAction(...)` exists, use it. If it does not exist, display blocker text only.

---

## Stage Routes

Create:

```text
src/components/journey/stageRoutes.ts
```

Export:

```ts
import type { LifecycleStage } from "@/buddy/lifecycle/model";

export function stageCanonicalRoute(stage: LifecycleStage, dealId: string): string;
```

Route map:

```ts
export function stageCanonicalRoute(stage: LifecycleStage, dealId: string): string {
  switch (stage) {
    case "intake_created":
    case "docs_requested":
    case "docs_in_progress":
    case "docs_satisfied":
      return `/deals/${dealId}/cockpit`;

    case "underwrite_ready":
    case "underwrite_in_progress":
      return `/deals/${dealId}/underwrite`;

    case "committee_ready":
      return `/deals/${dealId}/committee-studio`;

    case "committee_decisioned":
      return `/deals/${dealId}/decision`;

    case "closing_in_progress":
    case "closed":
      return `/deals/${dealId}/post-close`;

    case "workout":
      return `/deals/${dealId}/special-assets`;

    default:
      return `/deals/${dealId}/cockpit`;
  }
}
```

Before finalizing, verify these routes exist. If a route does not exist, keep fallback to cockpit and document it in the AAR.

---

## JourneyMiniRail

Create:

```text
src/components/journey/JourneyMiniRail.tsx
```

Purpose:

```text
Compact 11-dot journey indicator for deal list rows.
```

Props:

```ts
import type { LifecycleStage } from "@/buddy/lifecycle/model";

type JourneyMiniRailProps = {
  stage: LifecycleStage | string | null;
  className?: string;
};

export function JourneyMiniRail(props: JourneyMiniRailProps): JSX.Element;
```

Visual contract:

```text
●●●●○○○○○○○  Stage 4 of 11 — Documents complete
```

Rules:

* No fetching.
* No blockers.
* Accept existing `deals.stage` value.
* Map legacy values safely.

Legacy mapping:

```ts
function legacyStageToCanonical(s: string | null): LifecycleStage | null {
  if (!s) return null;

  const lower = s.toLowerCase();

  // direct match first
  // then fallbacks:
  if (lower === "collecting") return "docs_in_progress";
  if (lower === "underwriting") return "underwrite_in_progress";
  if (lower === "intake") return "intake_created";
  if (lower === "created") return "intake_created";
  if (lower === "closing") return "closing_in_progress";
  if (lower === "funded") return "closed";
  if (lower === "closed") return "closed";

  return null;
}
```

Unknown/null:

```text
Render all dots muted gray.
Tooltip: "Stage not yet derived."
```

---

## useJourneyState Hook

Create:

```text
src/hooks/useJourneyState.ts
```

Props/result:

```ts
import type { LifecycleState } from "@/buddy/lifecycle/model";

type UseJourneyStateResult = {
  state: LifecycleState | null;
  loading: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

export function useJourneyState(
  dealId: string,
  options?: {
    initialState?: LifecycleState | null;
    revalidateMs?: number;
  }
): UseJourneyStateResult;
```

Behavior:

* Fetch `/api/deals/[dealId]/lifecycle`.
* Use initialState immediately if provided.
* Revalidate every 30 seconds by default.
* Stop revalidation when document is hidden.
* Refetch on window focus.
* Use a module-level cache map.
* Do not add SWR/react-query unless already present.
* Do not use localStorage/sessionStorage/cookies.

---

## Integration

### Deal layout

Modify:

```text
src/app/(app)/deals/[dealId]/layout.tsx
```

Add JourneyRail to the deal workspace layout.

Desktop:

```text
left rail + main content
```

Mobile:

```text
top rail + content
```

The rail should not block existing pages from rendering.

---

### DealShell

Modify:

```text
src/app/(app)/deals/[dealId]/DealShell.tsx
```

Reduce tab strip to utility tabs only:

```text
Documents
Financials
Risk
Relationship
```

Remove stage-specific tabs from the strip:

```text
Builder
Underwrite
Committee
Credit Memo
Borrower
Feasibility
Portal
Post-Close
Reviews
Special Assets
SBA Package
Classic Spreads
```

Do not delete the old routes.

---

### Deal list

Modify:

```text
src/app/(app)/deals/page.tsx
```

Replace legacy stage string column with:

```tsx
<JourneyMiniRail stage={deal.stage} />
```

No per-row lifecycle fetches.

---

### Cockpit

Modify:

```text
src/components/deals/DealCockpitClient.tsx
```

Remove the `SecondaryTabsPanel` mount from the banker cockpit path.

Do not delete `SecondaryTabsPanel.tsx` yet. Keep the file for now.

SPEC-02 will retire it properly.

---

## UX Copy

Use lifecycle labels from `STAGE_LABELS` where available.

Generic fallback copy:

```text
Current stage
Next up
Blocked
Complete
Off path
```

Primary action labels should come from `getNextAction`.

Blocker copy should come from blocker messages.

Do not invent long explanatory copy in this PR.

---

## Accessibility

Requirements:

* Rail is keyboard navigable.
* Current stage has `aria-current="step"`.
* Locked stages are buttons or rows with `aria-disabled="true"`.
* Mini rail dots have accessible labels.
* Color is not the only indicator.
* Action button has descriptive text.

---

## Styling

Use existing project styling conventions.

Suggested visual language:

```text
complete: emerald
current: blue
next: neutral/outlined
locked: muted gray
skipped/workout off-path: muted amber or gray
blocker: amber/error chip
```

Do not introduce a new design system.

---

## Tests

### Unit: JourneyRail

Add tests for:

1. renders all canonical stages
2. marks current stage
3. marks completed stages
4. marks next stage when no blockers
5. marks future stages locked when blockers exist
6. workout branch handling
7. current stage renders exactly one action
8. locked stage does not navigate
9. infrastructure blocker renders as rail-level banner
10. stage-specific blocker renders on mapped stage
11. unknown stage does not crash

### Unit: JourneyMiniRail

Add tests for:

1. canonical stage renders correct dot count
2. legacy `collecting` maps to `docs_in_progress`
3. legacy `underwriting` maps to `underwrite_in_progress`
4. null renders muted unknown state
5. no fetch is performed

### Unit: blockerToStage

Add tests for:

1. known document blockers map to document stages
2. underwriting blockers map to underwriting stages
3. committee blocker maps to committee stage
4. infrastructure blockers return null
5. every blocker code in the runtime list maps to stage or null, never undefined

### E2E

Create:

```text
e2e/journey-rail.spec.ts
```

Use test deal if available:

```text
0279ed32-c25c-4919-b231-5790050331dd
```

If unavailable, read lifecycle state from the API and parameterize assertions.

E2E should verify:

1. JourneyRail renders on cockpit page
2. current stage is highlighted
3. stage rows are visible
4. current stage has one action or blocker
5. deal list shows JourneyMiniRail
6. DealShell has no more than 4 utility tabs

---

## Risk Register

### Risk: lifecycle exports differ

Mitigation:

```text
PIV catches it before coding.
```

### Risk: route map references missing route

Mitigation:

```text
fallback to /cockpit and document in AAR.
```

### Risk: tests expect old 18-tab DealShell

Mitigation:

```text
update tests in same PR.
```

### Risk: mobile layout breaks

Mitigation:

```text
horizontal rail below lg breakpoint.
```

### Risk: UI fetch duplication

Mitigation:

```text
use cockpit context where available; otherwise use hook.
```

---

## Verification Checklist

After implementation, verify:

### V-1

```text
src/components/journey/JourneyRail.tsx exists and exports JourneyRail.
```

### V-2

```text
src/components/journey/JourneyMiniRail.tsx exists and exports JourneyMiniRail.
```

### V-3

```text
src/buddy/lifecycle/blockerToStage.ts exists and handles blocker codes safely.
```

### V-4

```text
src/components/journey/stageRoutes.ts exists and has fallback route behavior.
```

### V-5

```text
DealShell tab list is reduced to no more than 4 utility tabs.
```

### V-6

```text
Deal workspace layout includes JourneyRail.
```

### V-7

```text
DealCockpitClient no longer mounts SecondaryTabsPanel.
```

### V-8

```text
Deal list renders JourneyMiniRail in the stage column.
```

### V-9

```text
JourneyRail renders all lifecycle stages and current action.
```

### V-10

```text
Unit tests pass.
```

### V-11

```text
Typecheck, lint, and build pass.
```

### V-12

```text
E2E journey rail test passes or is documented as skipped with reason.
```

---

## Required Commands

Run:

```bash
pnpm test:unit
pnpm typecheck
pnpm lint
pnpm build
```

If available:

```bash
pnpm test:e2e -- journey-rail.spec.ts
```

---

## Commit Plan

First commit the spec:

```bash
mkdir -p specs/banker-journey-fluidity
cat > specs/banker-journey-fluidity/SPEC-01-journey-rail.md <<'EOF'
# paste this spec here
EOF

git add specs/banker-journey-fluidity/SPEC-01-journey-rail.md
git commit -m "spec(journey): add banker journey rail contract"
```

Then implement.

Implementation PR title:

```text
feat(journey): add canonical banker journey rail
```

Implementation commit message:

```text
feat(journey-rail): SPEC-01 canonical lifecycle navigation
```

---

## AAR Requirements

When complete, report:

```text
PIV results
Files changed
What was implemented
What was intentionally not implemented
Routes verified / missing
Test results
V-1 through V-12 checklist
Screenshots if available
Known risks / follow-up items
```

---

## Critical Reminders

1. Read lifecycle code fresh.
2. Do not modify lifecycle engine.
3. Do not create a second state machine.
4. Do not start SPEC-02.
5. Do not delete old routes.
6. Do not hide unfinished stages.
7. Do not add local persistence.
8. Keep exactly one current-stage action.
9. Use lifecycle labels and next actions from existing lifecycle code.
10. If actual code differs from this spec, stop and report the delta.
