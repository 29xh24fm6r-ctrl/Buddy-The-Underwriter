"use client";

import { useShouldPoll } from "@/buddy/cockpit";
import { cn } from "@/lib/utils";

/**
 * Live Indicator Component
 *
 * Shows whether live updates are active in the cockpit.
 * - Green pulsing dot + "Live" when polling is active (deal is busy)
 * - Gray dot + "Idle" when polling is paused (deal is quiet)
 */
export function LiveIndicator() {
  const { shouldPoll, isBusy } = useShouldPoll();

  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors",
        shouldPoll
          ? "bg-emerald-500/10 text-emerald-300"
          : "bg-white/5 text-white/40"
      )}
      title={
        shouldPoll
          ? "Live updates active - deal is processing"
          : "Live updates paused - deal is idle"
      }
    >
      <span
        className={cn(
          "h-1.5 w-1.5 rounded-full",
          shouldPoll ? "bg-emerald-400 animate-pulse" : "bg-white/30"
        )}
      />
      <span>{shouldPoll ? "Live" : "Idle"}</span>
      {isBusy && shouldPoll && (
        <span className="text-emerald-400/60">(processing)</span>
      )}
    </div>
  );
}

/**
 * Compact version for tight spaces - just the dot.
 */
export function LiveDot() {
  const { shouldPoll } = useShouldPoll();

  return (
    <span
      className={cn(
        "h-2 w-2 rounded-full",
        shouldPoll ? "bg-emerald-400 animate-pulse" : "bg-white/20"
      )}
      title={shouldPoll ? "Live updates active" : "Live updates paused"}
    />
  );
}
