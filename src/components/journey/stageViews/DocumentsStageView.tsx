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
import { useRegisterStageRefresher } from "./_shared/useStageDataRefresh";
import { useStageDataContext } from "./_shared/StageDataProvider";

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
 * Heavy panels (LeftColumn / CenterColumn / ReadinessPanel / DocumentsTabPanel /
 * IntakeReviewTable) own their own internal fetches today. Per SPEC-05's
 * "do not rewrite business logic" rule, we register a remount-style
 * refresher: incrementing `refreshSeq` re-keys the wrapper so children
 * unmount + remount, kicking off fresh fetches.
 */
function DocumentsStageBody({ dealId, isAdmin }: { dealId: string; isAdmin: boolean }) {
  const { refreshSeq } = useStageDataContext();
  // Refresher is intentionally a no-op at this level — the remount key
  // does the real work. Registering it just satisfies the SPEC-05
  // "every stage registers a refresher" invariant and gives us a hook
  // for future fine-grained refreshers.
  useRegisterStageRefresher("documents:remount", () => {});

  return (
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
