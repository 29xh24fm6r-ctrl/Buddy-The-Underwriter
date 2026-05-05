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
  PostCloseChecklistPanel,
  type PostCloseData,
} from "./closing/PostCloseChecklistPanel";
import { ClosingDocsPanel } from "./closing/ClosingDocsPanel";
import {
  ExceptionTrackerPanel,
  type FinancialExceptions,
} from "./closing/ExceptionTrackerPanel";
import { ConditionsInlineEditor } from "./conditions/ConditionsInlineEditor";
import { CockpitAdvisorPanel } from "./_shared/CockpitAdvisorPanel";

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
      <ClosingStageBody dealId={dealId} isAdmin={isAdmin} />
    </StageWorkspaceShell>
  );
}

function ClosingStageBody({
  dealId,
  isAdmin,
}: {
  dealId: string;
  isAdmin: boolean;
}) {
  // SPEC-06: closing conditions are now editable inline; the read-only
  // ClosingConditionsPanel was replaced by ConditionsInlineEditor (which
  // owns its own /conditions/list fetch under scope: "conditions").
  // Post-close + financial exceptions remain stage-owned under their own
  // scope, "closing".
  const postClose = useStageJsonResource<PostCloseData>(
    `/api/deals/${dealId}/post-close`,
    { id: "closing:post-close", scope: "closing" },
  );
  const financialExceptions = useStageJsonResource<FinancialExceptions>(
    `/api/deals/${dealId}/financial-exceptions`,
    { id: "closing:financial-exceptions", scope: "closing" },
  );

  const exceptionsLoading = financialExceptions.loading || postClose.loading;
  const exceptionsError = financialExceptions.error ?? postClose.error;

  return (
    <div className="space-y-4">
      <SafeBoundary>
        <CockpitAdvisorPanel dealId={dealId} />
      </SafeBoundary>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12 lg:gap-6">
      <div className="space-y-4 lg:col-span-8">
        <SafeBoundary>
          <ConditionsInlineEditor dealId={dealId} surface="closing" />
        </SafeBoundary>
        <SafeBoundary>
          <PostCloseChecklistPanel
            dealId={dealId}
            postClose={postClose.data}
            loading={postClose.loading}
            error={postClose.error}
          />
        </SafeBoundary>
        <SafeBoundary>
          <ClosingDocsPanel dealId={dealId} />
        </SafeBoundary>
        <SafeBoundary>
          <ExceptionTrackerPanel
            dealId={dealId}
            financialExceptions={financialExceptions.data}
            postClose={postClose.data}
            loading={exceptionsLoading}
            error={exceptionsError}
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
