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
import { useStageDataContext } from "./_shared/StageDataProvider";
import { DocumentChecklistSurface } from "./documents/DocumentChecklistSurface";
import { IntakeReviewSurface } from "./documents/IntakeReviewSurface";
import { UploadRequestSurface } from "./documents/UploadRequestSurface";

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
          <DocumentsAdvancedBody dealId={dealId} isAdmin={isAdmin} stage={stage} />
        </AdvancedDisclosure>
      }
    >
      <DocumentsStageBody dealId={dealId} isAdmin={isAdmin} />
    </StageWorkspaceShell>
  );
}

/**
 * SPEC-06: heads of the Documents stage are now stage-owned summary
 * surfaces (DocumentChecklistSurface / IntakeReviewSurface /
 * UploadRequestSurface) — each fetches via useStageJsonResource (scope:
 * "documents") so they participate in scoped refresh.
 *
 * The legacy heavy panels (LeftColumn / CenterColumn / ReadinessPanel)
 * still mount underneath for full per-row checklist editing; they remain
 * remount-keyed via refreshSeq from SPEC-05 so router-level refreshes
 * still recompose them. This is intentionally a layered approach: thin
 * surfaces own the headline, full panels own the deep edit.
 */
function DocumentsStageBody({ dealId, isAdmin }: { dealId: string; isAdmin: boolean }) {
  const { refreshSeq } = useStageDataContext();

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <SafeBoundary>
          <DocumentChecklistSurface dealId={dealId} />
        </SafeBoundary>
        <SafeBoundary>
          <IntakeReviewSurface dealId={dealId} />
        </SafeBoundary>
        <SafeBoundary>
          <UploadRequestSurface dealId={dealId} />
        </SafeBoundary>
      </div>

      <div
        key={`docs-stage-${refreshSeq}`}
        className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6"
      >
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
    </div>
  );
}

function DocumentsAdvancedBody({
  dealId,
  isAdmin,
  stage,
}: {
  dealId: string;
  isAdmin: boolean;
  stage: LifecycleState["stage"] | null;
}) {
  const { refreshSeq } = useStageDataContext();
  return (
    <div key={`docs-advanced-${refreshSeq}`} className="space-y-3">
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
    </div>
  );
}
