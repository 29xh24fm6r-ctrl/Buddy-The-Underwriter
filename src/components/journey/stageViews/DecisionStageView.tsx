"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { NextAction } from "@/buddy/lifecycle/nextAction";
import { ReadinessPanel } from "@/components/deals/cockpit/panels/ReadinessPanel";
import { ForceAdvancePanel } from "@/components/deals/ForceAdvancePanel";
import { DealStoryTimeline } from "@/components/deals/DealStoryTimeline";
import { StageWorkspaceShell } from "./_shared/StageWorkspaceShell";
import { AdvancedDisclosure } from "./_shared/AdvancedDisclosure";
import { DecisionSummaryPanel } from "./decision/DecisionSummaryPanel";
import { ApprovalConditionsPanel } from "./decision/ApprovalConditionsPanel";
import { OverrideAuditPanel } from "./decision/OverrideAuditPanel";
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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        <div className="space-y-4 lg:col-span-8">
          <SafeBoundary>
            <DecisionSummaryPanel dealId={dealId} />
          </SafeBoundary>
          <SafeBoundary>
            <ApprovalConditionsPanel dealId={dealId} />
          </SafeBoundary>
          <SafeBoundary>
            <OverrideAuditPanel dealId={dealId} />
          </SafeBoundary>
          <SafeBoundary>
            <DecisionLetterPanel dealId={dealId} />
          </SafeBoundary>
        </div>
        <div className="space-y-4 lg:col-span-4">
          <SafeBoundary>
            <ReadinessPanel dealId={dealId} isAdmin={isAdmin} />
          </SafeBoundary>
        </div>
      </div>
    </StageWorkspaceShell>
  );
}
