"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { NextAction } from "@/buddy/lifecycle/nextAction";
import { ReadinessPanel } from "@/components/deals/cockpit/panels/ReadinessPanel";
import { ForceAdvancePanel } from "@/components/deals/ForceAdvancePanel";
import { DealStoryTimeline } from "@/components/deals/DealStoryTimeline";
import { StageWorkspaceShell } from "./_shared/StageWorkspaceShell";
import { AdvancedDisclosure } from "./_shared/AdvancedDisclosure";
import { useStageJsonResource } from "./_shared/useStageJsonResource";
import {
  DecisionSummaryPanel,
  type DecisionLatest,
} from "./decision/DecisionSummaryPanel";
import { DecisionLetterPanel } from "./decision/DecisionLetterPanel";
import { ConditionsInlineEditor } from "./conditions/ConditionsInlineEditor";
import { OverrideInlineEditor } from "./decision/OverrideInlineEditor";

export function DecisionStageView({
  dealId,
  state,
  action,
  isAdmin = false,
}: {
  dealId: string;
  state: LifecycleState | null;
  action: NextAction | null;
  isAdmin?: boolean;
}) {
  const stage = state?.stage ?? null;
  const blockers = state?.blockers ?? [];

  return (
    <StageWorkspaceShell
      stage={stage}
      dealId={dealId}
      action={action}
      blockers={blockers}
      subtitle="Decision recorded. Track conditions and overrides, then send the borrower-facing letter."
      advanced={
        <AdvancedDisclosure>
          <SafeBoundary>
            <DealStoryTimeline dealId={dealId} />
          </SafeBoundary>
          {isAdmin ? (
            <SafeBoundary>
              <ForceAdvancePanel dealId={dealId} currentStage={stage} />
            </SafeBoundary>
          ) : null}
        </AdvancedDisclosure>
      }
    >
      <DecisionStageBody dealId={dealId} isAdmin={isAdmin} />
    </StageWorkspaceShell>
  );
}

function DecisionStageBody({
  dealId,
  isAdmin,
}: {
  dealId: string;
  isAdmin: boolean;
}) {
  // Decision summary + letter share /decision/latest under scope: "decision".
  // Conditions + overrides are owned by their inline editors under their
  // own scopes ("conditions" / "overrides"), so a status mutation triggers
  // a scoped refresh of just that surface.
  const decision = useStageJsonResource<DecisionLatest>(
    `/api/deals/${dealId}/decision/latest`,
    { id: "decision:latest", scope: "decision" },
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
      <div className="space-y-4 lg:col-span-8">
        <SafeBoundary>
          <DecisionSummaryPanel
            dealId={dealId}
            decision={decision.data}
            loading={decision.loading}
            error={decision.error}
          />
        </SafeBoundary>
        <SafeBoundary>
          <ConditionsInlineEditor dealId={dealId} surface="decision" />
        </SafeBoundary>
        <SafeBoundary>
          <OverrideInlineEditor dealId={dealId} />
        </SafeBoundary>
        <SafeBoundary>
          <DecisionLetterPanel
            dealId={dealId}
            decision={decision.data}
            loading={decision.loading}
            error={decision.error}
          />
        </SafeBoundary>
      </div>
      <div className="space-y-4 lg:col-span-4">
        <SafeBoundary>
          <ReadinessPanel dealId={dealId} isAdmin={isAdmin} />
        </SafeBoundary>
      </div>
    </div>
  );
}
