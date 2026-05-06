"use client";

import type { LifecycleState } from "@/buddy/lifecycle/model";
import { STAGE_LABELS } from "@/buddy/lifecycle/model";

export type RailHeaderProps = {
  dealId: string;
  dealLabel?: string | null;
  borrowerName?: string | null;
  state: LifecycleState | null;
  loading?: boolean;
};

export function RailHeader({ dealLabel, borrowerName, state, loading }: RailHeaderProps) {
  const stageLabel = state ? STAGE_LABELS[state.stage] ?? state.stage : null;

  return (
    <div className="px-4 pt-4 pb-3 border-b border-white/10" data-testid="journey-rail-header">
      <div className="text-[10px] uppercase tracking-wide text-white/50">Deal</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-white" title={dealLabel ?? undefined}>
        {dealLabel ?? "Untitled deal"}
      </div>
      {borrowerName ? (
        <div className="text-xs text-white/60 truncate" title={borrowerName}>
          {borrowerName}
        </div>
      ) : null}
      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wide text-white/50">Current stage</div>
        <div className="text-xs font-semibold text-white">
          {loading && !stageLabel ? "Loading…" : stageLabel ?? "—"}
        </div>
      </div>
    </div>
  );
}
