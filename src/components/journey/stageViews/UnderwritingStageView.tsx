"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { NextAction } from "@/buddy/lifecycle/nextAction";
import { ReadinessPanel } from "@/components/deals/cockpit/panels/ReadinessPanel";
import RiskDashboardPanel from "@/components/deals/cockpit/panels/RiskDashboardPanel";
import StoryPanel from "@/components/deals/cockpit/panels/StoryPanel";
import { UnderwritingControlPanel } from "@/components/deals/UnderwritingControlPanel";
import { DealOutputsPanel } from "@/components/deals/DealOutputsPanel";
import { PreviewUnderwritePanel } from "@/components/deals/PreviewUnderwritePanel";
import { ForceAdvancePanel } from "@/components/deals/ForceAdvancePanel";
import { DealStoryTimeline } from "@/components/deals/DealStoryTimeline";
import type { VerifyUnderwriteResult } from "@/lib/deals/verifyUnderwriteCore";
import { StageWorkspaceShell } from "./_shared/StageWorkspaceShell";
import { AdvancedDisclosure } from "./_shared/AdvancedDisclosure";

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
          <SafeBoundary>
            <DealOutputsPanel dealId={dealId} verify={verify ?? FALLBACK_VERIFY} />
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
        </AdvancedDisclosure>
      }
    >
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
        <div className="space-y-4 lg:col-span-8">
          <SafeBoundary>
            <RiskDashboardPanel dealId={dealId} />
          </SafeBoundary>
          {/* StoryPanel keeps DealHealthPanel + BankerVoicePanel in the cockpit. */}
          <SafeBoundary>
            <StoryPanel dealId={dealId} />
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
    </StageWorkspaceShell>
  );
}
