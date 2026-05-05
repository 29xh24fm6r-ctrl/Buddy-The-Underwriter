"use client";

import Link from "next/link";
import { SafeBoundary } from "@/components/SafeBoundary";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { NextAction } from "@/buddy/lifecycle/nextAction";
import { ReadinessPanel } from "@/components/deals/cockpit/panels/ReadinessPanel";
import { ForceAdvancePanel } from "@/components/deals/ForceAdvancePanel";
import { DealStoryTimeline } from "@/components/deals/DealStoryTimeline";
import { StageWorkspaceShell } from "./_shared/StageWorkspaceShell";
import { AdvancedDisclosure } from "./_shared/AdvancedDisclosure";

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
      subtitle="Credit memo is ready. Reconcile flags and move into committee."
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
        <div className="space-y-3 lg:col-span-8">
          <CommitteeWorkSurfaceCard dealId={dealId} />
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

function CommitteeWorkSurfaceCard({ dealId }: { dealId: string }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="material-symbols-outlined text-blue-300 text-[20px]">groups</span>
        <h3 className="text-sm font-semibold text-white">Committee Work Surface</h3>
      </div>
      <p className="text-xs text-white/60 mb-4">
        Detailed memo, reconciliation, and committee voting live on dedicated surfaces.
        SPEC-03 will fold these into the cockpit body.
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Link
          href={`/deals/${dealId}/credit-memo`}
          className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          Credit Memo
          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </Link>
        <Link
          href={`/deals/${dealId}/committee-studio`}
          className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          Committee Studio
          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </Link>
        <Link
          href={`/deals/${dealId}/memo-template`}
          className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
        >
          Memo Template
          <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
        </Link>
      </div>
    </div>
  );
}
