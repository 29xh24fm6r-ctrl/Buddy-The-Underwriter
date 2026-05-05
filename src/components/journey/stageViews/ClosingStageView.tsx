"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { NextAction } from "@/buddy/lifecycle/nextAction";
import { ReadinessPanel } from "@/components/deals/cockpit/panels/ReadinessPanel";
import { ForceAdvancePanel } from "@/components/deals/ForceAdvancePanel";
import { DealStoryTimeline } from "@/components/deals/DealStoryTimeline";
import { StageWorkspaceShell } from "./_shared/StageWorkspaceShell";
import { AdvancedDisclosure } from "./_shared/AdvancedDisclosure";
import { ClosingConditionsPanel } from "./closing/ClosingConditionsPanel";
import { PostCloseChecklistPanel } from "./closing/PostCloseChecklistPanel";
import { ClosingDocsPanel } from "./closing/ClosingDocsPanel";
import { ExceptionTrackerPanel } from "./closing/ExceptionTrackerPanel";

export function ClosingStageView({
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
  const isClosed = stage === "closed";

  return (
    <StageWorkspaceShell
      stage={stage}
      dealId={dealId}
      action={action}
      blockers={blockers}
      subtitle={
        isClosed
          ? "Deal is closed. Stay on top of post-close obligations and exceptions."
          : "Track closing conditions, missing docs, and exceptions in one place."
      }
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
            <ClosingConditionsPanel dealId={dealId} />
          </SafeBoundary>
          <SafeBoundary>
            <PostCloseChecklistPanel dealId={dealId} />
          </SafeBoundary>
          <SafeBoundary>
            <ClosingDocsPanel dealId={dealId} />
          </SafeBoundary>
          <SafeBoundary>
            <ExceptionTrackerPanel dealId={dealId} />
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
