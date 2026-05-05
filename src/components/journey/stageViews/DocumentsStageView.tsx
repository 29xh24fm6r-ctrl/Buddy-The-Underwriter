"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { NextAction } from "@/buddy/lifecycle/nextAction";
import { LeftColumn } from "@/components/deals/cockpit/columns/LeftColumn";
import { CenterColumn } from "@/components/deals/cockpit/columns/CenterColumn";
import { ReadinessPanel } from "@/components/deals/cockpit/panels/ReadinessPanel";
import { DocumentsTabPanel } from "@/components/deals/cockpit/panels/DocumentsTabPanel";
import { IntakeReviewTable } from "@/components/deals/intake/IntakeReviewTable";
import { ForceAdvancePanel } from "@/components/deals/ForceAdvancePanel";
import { DealStoryTimeline } from "@/components/deals/DealStoryTimeline";
import { StageWorkspaceShell } from "./_shared/StageWorkspaceShell";
import { AdvancedDisclosure } from "./_shared/AdvancedDisclosure";

export function DocumentsStageView({
  dealId,
  state,
  action,
  variant,
  isAdmin = false,
}: {
  dealId: string;
  state: LifecycleState | null;
  action: NextAction | null;
  /** "collecting" = docs_in_progress, "complete" = docs_satisfied */
  variant: "collecting" | "complete";
  isAdmin?: boolean;
}) {
  const stage = state?.stage ?? null;
  const blockers = state?.blockers ?? [];

  const subtitle =
    variant === "collecting"
      ? "Track uploads, watch AI classification, and clear missing items."
      : "All required documents are in. Review and proceed to underwriting.";

  return (
    <StageWorkspaceShell
      stage={stage}
      dealId={dealId}
      action={action}
      blockers={blockers}
      subtitle={subtitle}
      advanced={
        <AdvancedDisclosure>
          <SafeBoundary>
            <DocumentsTabPanel dealId={dealId} isAdmin={isAdmin} />
          </SafeBoundary>
          <SafeBoundary>
            <IntakeReviewTable dealId={dealId} />
          </SafeBoundary>
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
        <div className="lg:col-span-5">
          <SafeBoundary>
            <LeftColumn dealId={dealId} isAdmin={isAdmin} />
          </SafeBoundary>
        </div>
        <div className="lg:col-span-4">
          <SafeBoundary>
            <CenterColumn dealId={dealId} />
          </SafeBoundary>
        </div>
        <div className="lg:col-span-3">
          <SafeBoundary>
            <ReadinessPanel dealId={dealId} isAdmin={isAdmin} />
          </SafeBoundary>
        </div>
      </div>
    </StageWorkspaceShell>
  );
}
