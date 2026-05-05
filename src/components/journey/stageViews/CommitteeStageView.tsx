"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { NextAction } from "@/buddy/lifecycle/nextAction";
import { ReadinessPanel } from "@/components/deals/cockpit/panels/ReadinessPanel";
import { ForceAdvancePanel } from "@/components/deals/ForceAdvancePanel";
import { DealStoryTimeline } from "@/components/deals/DealStoryTimeline";
import { StageWorkspaceShell } from "./_shared/StageWorkspaceShell";
import { AdvancedDisclosure } from "./_shared/AdvancedDisclosure";
import { CreditMemoPanel } from "./committee/CreditMemoPanel";
import { MemoReconciliationPanel } from "./committee/MemoReconciliationPanel";
import { CommitteePackagePanel } from "./committee/CommitteePackagePanel";
import { ApprovalReadinessPanel } from "./committee/ApprovalReadinessPanel";

export function CommitteeStageView({
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
      subtitle="Review the memo, reconcile gaps, and prepare the committee packet — all in cockpit."
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
            <CreditMemoPanel dealId={dealId} />
          </SafeBoundary>
          <SafeBoundary>
            <MemoReconciliationPanel dealId={dealId} />
          </SafeBoundary>
          <SafeBoundary>
            <CommitteePackagePanel dealId={dealId} />
          </SafeBoundary>
          <SafeBoundary>
            <ApprovalReadinessPanel dealId={dealId} />
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
