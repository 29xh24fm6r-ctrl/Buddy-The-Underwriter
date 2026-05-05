"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { NextAction } from "@/buddy/lifecycle/nextAction";
import { ReadinessPanel } from "@/components/deals/cockpit/panels/ReadinessPanel";
import RiskDashboardPanel from "@/components/deals/cockpit/panels/RiskDashboardPanel";
import { UnderwritingControlPanel } from "@/components/deals/UnderwritingControlPanel";
import { DealOutputsPanel } from "@/components/deals/DealOutputsPanel";
import { PreviewUnderwritePanel } from "@/components/deals/PreviewUnderwritePanel";
import { ForceAdvancePanel } from "@/components/deals/ForceAdvancePanel";
import { DealStoryTimeline } from "@/components/deals/DealStoryTimeline";
import type { VerifyUnderwriteResult } from "@/lib/deals/verifyUnderwriteCore";
import { StageWorkspaceShell } from "./_shared/StageWorkspaceShell";
import { AdvancedDisclosure } from "./_shared/AdvancedDisclosure";
import { useStageDataContext } from "./_shared/StageDataProvider";
import { RiskSummarySurface } from "./underwriting/RiskSummarySurface";
import { BankerVoiceSurface } from "./underwriting/BankerVoiceSurface";
import { UnderwritingActionsSurface } from "./underwriting/UnderwritingActionsSurface";
import { CockpitAdvisorPanel } from "./_shared/CockpitAdvisorPanel";

const FALLBACK_VERIFY: VerifyUnderwriteResult = {
  ok: false,
  dealId: "",
  auth: true,
  recommendedNextAction: "deal_not_found",
  diagnostics: {},
  ledgerEventsWritten: [],
};

export function UnderwritingStageView({
  dealId,
  state,
  action,
  variant,
  isAdmin = false,
  verify,
}: {
  dealId: string;
  state: LifecycleState | null;
  action: NextAction | null;
  /** "ready" = underwrite_ready, "in_progress" = underwrite_in_progress */
  variant: "ready" | "in_progress";
  isAdmin?: boolean;
  verify?: VerifyUnderwriteResult | null;
}) {
  const stage = state?.stage ?? null;
  const blockers = state?.blockers ?? [];

  const subtitle =
    variant === "ready"
      ? "Spreads are built, snapshot is staged. Kick off the model when ready."
      : "Refine spreads, run risk, and let the analyst shape the credit memo.";

  return (
    <StageWorkspaceShell
      stage={stage}
      dealId={dealId}
      action={action}
      blockers={blockers}
      subtitle={subtitle}
      advanced={
        <AdvancedDisclosure>
          <UnderwritingAdvancedBody
            dealId={dealId}
            isAdmin={isAdmin}
            stage={stage}
            verify={verify ?? FALLBACK_VERIFY}
          />
        </AdvancedDisclosure>
      }
    >
      <UnderwritingStageBody dealId={dealId} stage={stage} isAdmin={isAdmin} />
    </StageWorkspaceShell>
  );
}

/**
 * SPEC-06: lifted summary surfaces own their own scoped data:
 *   - RiskSummarySurface (lifecycle.derived signals)
 *   - BankerVoiceSurface (banker voice + deal health, scoped remount)
 *   - UnderwritingActionsSurface (runnable actions via shared runner)
 *
 * The legacy RiskDashboardPanel + UnderwritingControlPanel + ReadinessPanel
 * remain mounted underneath for the deep workbench. They are NO LONGER
 * remounted as a side effect of the whole body — only on a deliberate
 * underwriting-scoped refresh.
 */
function UnderwritingStageBody({
  dealId,
  stage,
  isAdmin,
}: {
  dealId: string;
  stage: LifecycleState["stage"] | null;
  isAdmin: boolean;
}) {
  const { refreshSeq } = useStageDataContext();

  return (
    <div className="space-y-4">
      <SafeBoundary>
        <CockpitAdvisorPanel dealId={dealId} />
      </SafeBoundary>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:gap-4">
        <div className="space-y-3 lg:col-span-7">
          <SafeBoundary>
            <RiskSummarySurface dealId={dealId} />
          </SafeBoundary>
          <SafeBoundary>
            <UnderwritingActionsSurface dealId={dealId} />
          </SafeBoundary>
        </div>
        <div className="space-y-3 lg:col-span-5">
          <SafeBoundary>
            <BankerVoiceSurface dealId={dealId} />
          </SafeBoundary>
        </div>
      </div>

      {/* Legacy workbench — mounted under the lifted summary heads. */}
      <div
        key={`underwriting-legacy-${refreshSeq}`}
        className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6"
      >
        <div className="space-y-4 lg:col-span-8">
          <SafeBoundary>
            <RiskDashboardPanel dealId={dealId} />
          </SafeBoundary>
          <SafeBoundary>
            <UnderwritingControlPanel
              dealId={dealId}
              lifecycleStage={stage}
            />
          </SafeBoundary>
        </div>
        <div className="space-y-4 lg:col-span-4">
          <SafeBoundary>
            <ReadinessPanel dealId={dealId} isAdmin={isAdmin} />
          </SafeBoundary>
        </div>
      </div>
    </div>
  );
}

function UnderwritingAdvancedBody({
  dealId,
  isAdmin,
  stage,
  verify,
}: {
  dealId: string;
  isAdmin: boolean;
  stage: LifecycleState["stage"] | null;
  verify: VerifyUnderwriteResult;
}) {
  const { refreshSeq } = useStageDataContext();
  return (
    <div key={`underwriting-advanced-${refreshSeq}`} className="space-y-3">
      <SafeBoundary>
        <DealOutputsPanel dealId={dealId} verify={verify} />
      </SafeBoundary>
      <SafeBoundary>
        <PreviewUnderwritePanel dealId={dealId} />
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
