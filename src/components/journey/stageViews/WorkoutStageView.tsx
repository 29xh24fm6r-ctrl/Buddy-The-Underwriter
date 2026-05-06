"use client";

import Link from "next/link";
import { SafeBoundary } from "@/components/SafeBoundary";
import type { LifecycleState } from "@/buddy/lifecycle/model";
import type { NextAction } from "@/buddy/lifecycle/nextAction";
import { ForceAdvancePanel } from "@/components/deals/ForceAdvancePanel";
import { DealStoryTimeline } from "@/components/deals/DealStoryTimeline";
import { StageWorkspaceShell } from "./_shared/StageWorkspaceShell";
import { AdvancedDisclosure } from "./_shared/AdvancedDisclosure";
import { useRegisterStageRefresher } from "./_shared/useStageDataRefresh";
import { useStageDataContext } from "./_shared/StageDataProvider";

export function WorkoutStageView({
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
      subtitle="This deal is on the workout path. Use Special Assets to track recovery."
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
      <WorkoutStageBody dealId={dealId} />
    </StageWorkspaceShell>
  );
}

function WorkoutStageBody({ dealId }: { dealId: string }) {
  const { refreshSeq } = useStageDataContext();
  useRegisterStageRefresher("workout:remount", () => {});

  return (
    <div
      key={`workout-stage-${refreshSeq}`}
      className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-amber-300 text-[20px]">build</span>
          <h3 className="text-sm font-semibold text-white">Special Assets</h3>
        </div>
        <p className="text-xs text-amber-100/80 mb-4">
          Recovery, watchlist, workout cases, and special-asset tooling live on
          dedicated surfaces.
        </p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Link
            href={`/deals/${dealId}/special-assets`}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
          >
            Special Assets
            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
          </Link>
          <Link
            href={`/deals/${dealId}/risk`}
            className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/80 hover:bg-white/10"
          >
            Risk
            <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
          </Link>
        </div>
      </div>
  );
}
