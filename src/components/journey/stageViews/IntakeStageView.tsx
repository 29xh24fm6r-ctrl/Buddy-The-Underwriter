"use client";

import { SafeBoundary } from "@/components/SafeBoundary";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { NextAction } from "@/buddy/lifecycle/nextAction";
import DealIntakeCard from "@/components/deals/DealIntakeCard";
import BorrowerAttachmentCard from "@/components/deals/BorrowerAttachmentCard";
import BorrowerRequestComposerCard from "@/components/deals/BorrowerRequestComposerCard";
import BorrowerUploadLinksCard from "@/components/deals/BorrowerUploadLinksCard";
import { LoanRequestsSection } from "@/components/loanRequests/LoanRequestsSection";
import { ForceAdvancePanel } from "@/components/deals/ForceAdvancePanel";
import { StageWorkspaceShell } from "./_shared/StageWorkspaceShell";
import { AdvancedDisclosure } from "./_shared/AdvancedDisclosure";

export function IntakeStageView({
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
      subtitle="Set up the deal, attach the borrower, and request the documents you need."
      advanced={
        <AdvancedDisclosure>
          {isAdmin ? (
            <SafeBoundary>
              <ForceAdvancePanel dealId={dealId} currentStage={stage} />
            </SafeBoundary>
          ) : null}
        </AdvancedDisclosure>
      }
    >
      <SafeBoundary>
        <DealIntakeCard
          dealId={dealId}
          isAdmin={isAdmin}
          lifecycleStage={stage}
        />
      </SafeBoundary>
      <SafeBoundary>
        <LoanRequestsSection dealId={dealId} />
      </SafeBoundary>
      <SafeBoundary>
        <BorrowerAttachmentCard dealId={dealId} />
      </SafeBoundary>
      <SafeBoundary>
        <BorrowerRequestComposerCard dealId={dealId} />
      </SafeBoundary>
      <SafeBoundary>
        <BorrowerUploadLinksCard dealId={dealId} lifecycleStage={stage} />
      </SafeBoundary>
    </StageWorkspaceShell>
  );
}
