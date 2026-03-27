"use client";

import type { BuddyCanonicalState } from "@/core/state/types";
import { STAGE_LABELS } from "@/buddy/lifecycle/client";

export function DealStateHeader({ state }: { state: BuddyCanonicalState }) {
  const stageLabel = STAGE_LABELS[state.lifecycle] ?? state.lifecycle;
  const hasBlockers = state.blockers.length > 0;

  return (
    <div data-testid="deal-state-header" className="space-y-2">
      {/* Stage badge */}
      <div className="flex items-center gap-2">
        <span className="text-[10px] uppercase tracking-wide text-white/50">
          Stage
        </span>
        <span className="rounded-full border border-white/15 bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-white">
          {stageLabel}
        </span>
      </div>

      {/* Blockers */}
      {hasBlockers && (
        <div className="flex flex-wrap gap-1.5">
          {state.blockers.slice(0, 3).map((b) => (
            <span
              key={b.code}
              className="rounded-full border border-amber-500/30 bg-amber-600/20 px-2 py-0.5 text-[11px] font-semibold text-amber-200"
              title={b.message}
            >
              {b.code.replace(/_/g, " ")}
            </span>
          ))}
          {state.blockers.length > 3 && (
            <span className="text-[11px] text-white/50">
              +{state.blockers.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Next required action */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-white/50">Next:</span>
        <span className="font-medium text-white">
          {state.nextRequiredAction.label}
        </span>
      </div>
    </div>
  );
}
