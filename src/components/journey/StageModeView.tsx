"use client";

import { useCockpitDataContext } from "@/buddy/cockpit/useCockpitData";
import { getNextAction } from "@/buddy/lifecycle/nextAction";
import type { LifecycleStage, LifecycleState } from "@/buddy/lifecycle/model";
import type { VerifyUnderwriteResult } from "@/lib/deals/verifyUnderwriteCore";
import { IntakeStageView } from "./stageViews/IntakeStageView";
import { DocumentsStageView } from "./stageViews/DocumentsStageView";
import { UnderwritingStageView } from "./stageViews/UnderwritingStageView";
import { CommitteeStageView } from "./stageViews/CommitteeStageView";
import { DecisionStageView } from "./stageViews/DecisionStageView";
import { ClosingStageView } from "./stageViews/ClosingStageView";
import { WorkoutStageView } from "./stageViews/WorkoutStageView";

/**
 * Stage-driven cockpit body.
 *
 * - Reads `lifecycleState` from `CockpitDataContext` — does NOT invoke the
 *   journey-state hook here, to avoid duplicating the lifecycle fetch.
 * - Switches on `state.stage` and renders exactly one stage view.
 * - Each stage view owns its single primary action via `getNextAction`.
 * - Falls back to IntakeStageView when state is null (loading / unknown).
 */
export function StageModeView({
  dealId,
  isAdmin = false,
  verify,
}: {
  dealId: string;
  isAdmin?: boolean;
  verify?: VerifyUnderwriteResult | null;
}) {
  const { lifecycleState } = useCockpitDataContext();
  const state: LifecycleState | null = lifecycleState ?? null;
  const stage: LifecycleStage | null = state?.stage ?? null;
  const action = state ? getNextAction(state, dealId) : null;

  if (stage === "intake_created" || stage === "docs_requested" || stage === null) {
    return (
      <IntakeStageView
        dealId={dealId}
        state={state}
        action={action}
        isAdmin={isAdmin}
      />
    );
  }

  if (stage === "docs_in_progress") {
    return (
      <DocumentsStageView
        dealId={dealId}
        state={state}
        action={action}
        variant="collecting"
        isAdmin={isAdmin}
      />
    );
  }

  if (stage === "docs_satisfied") {
    return (
      <DocumentsStageView
        dealId={dealId}
        state={state}
        action={action}
        variant="complete"
        isAdmin={isAdmin}
      />
    );
  }

  if (stage === "memo_inputs_required") {
    // Reuse the documents-complete variant since the cockpit copy is
    // identical from the user's perspective ("docs are done, do this
    // next") — the action button (`Complete Memo Inputs`) is what
    // changes. The dedicated memo-inputs page renders the actual surface.
    return (
      <DocumentsStageView
        dealId={dealId}
        state={state}
        action={action}
        variant="complete"
        isAdmin={isAdmin}
      />
    );
  }

  if (stage === "underwrite_ready") {
    return (
      <UnderwritingStageView
        dealId={dealId}
        state={state}
        action={action}
        variant="ready"
        isAdmin={isAdmin}
        verify={verify ?? null}
      />
    );
  }

  if (stage === "underwrite_in_progress") {
    return (
      <UnderwritingStageView
        dealId={dealId}
        state={state}
        action={action}
        variant="in_progress"
        isAdmin={isAdmin}
        verify={verify ?? null}
      />
    );
  }

  if (stage === "committee_ready") {
    return (
      <CommitteeStageView
        dealId={dealId}
        state={state}
        action={action}
        isAdmin={isAdmin}
      />
    );
  }

  if (stage === "committee_decisioned") {
    return (
      <DecisionStageView
        dealId={dealId}
        state={state}
        action={action}
        isAdmin={isAdmin}
      />
    );
  }

  if (stage === "closing_in_progress" || stage === "closed") {
    return (
      <ClosingStageView
        dealId={dealId}
        state={state}
        action={action}
        isAdmin={isAdmin}
      />
    );
  }

  if (stage === "workout") {
    return (
      <WorkoutStageView
        dealId={dealId}
        state={state}
        action={action}
        isAdmin={isAdmin}
      />
    );
  }

  // Exhaustiveness: `_neverStage` ensures TypeScript flags any new stage
  // without a mapped view. We still render a safe fallback at runtime.
  const _neverStage: never = stage;
  void _neverStage;
  return (
    <IntakeStageView
      dealId={dealId}
      state={state}
      action={action}
      isAdmin={isAdmin}
    />
  );
}
