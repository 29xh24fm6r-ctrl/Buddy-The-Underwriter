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
import {
  ApprovalConditionsPanel,
  type ConditionsList,
} from "./decision/ApprovalConditionsPanel";
import {
  OverrideAuditPanel,
  type OverridesList,
} from "./decision/OverrideAuditPanel";
import { DecisionLetterPanel } from "./decision/DecisionLetterPanel";

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
  // Stage-owned data fetches. Each registers itself with the
  // StageDataProvider so cockpit actions auto-refresh them.
  const decision = useStageJsonResource<DecisionLatest>(
    `/api/deals/${dealId}/decision/latest`,
    { id: "decision:latest" },
  );
  const conditions = useStageJsonResource<ConditionsList>(
    `/api/deals/${dealId}/conditions`,
    { id: "decision:conditions" },
  );
  const overrides = useStageJsonResource<OverridesList>(
    `/api/deals/${dealId}/overrides`,
    { id: "decision:overrides" },
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
          <ApprovalConditionsPanel
            dealId={dealId}
            conditions={conditions.data}
            loading={conditions.loading}
            error={conditions.error}
          />
        </SafeBoundary>
        <SafeBoundary>
          <OverrideAuditPanel
            dealId={dealId}
            overrides={overrides.data}
            loading={overrides.loading}
            error={overrides.error}
          />
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
