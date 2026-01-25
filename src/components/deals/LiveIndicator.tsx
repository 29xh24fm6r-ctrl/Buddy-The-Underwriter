"use client";

import { useContext } from "react";
import { useShouldPoll, useCockpitDataContext } from "@/buddy/cockpit";
import { cn } from "@/lib/utils";

/**
 * Live Indicator Component
 *
 * Shows whether live updates are active in the cockpit.
 * - Green pulsing dot + "Live" when polling is active (deal is busy OR user recently acted)
 * - Gray dot + "Idle" when polling is paused (deal is quiet and user inactive)
 * - Shows "(processing)" suffix when uploads/AI are actively working
 */
export function LiveIndicator() {
  const { shouldPoll, isBusy } = useShouldPoll();

  // Try to get full context for more detail
  let processingCount = 0;
  let userActive = false;
  try {
    const ctx = useCockpitDataContext();
    processingCount = ctx.processingUploads;
    userActive = ctx.userRecentlyActive;
  } catch {
    // Not in context, use basic mode
  }

  // Determine the reason we're live
  const liveReason = isBusy ? "processing" : userActive ? "active" : null;

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
          ? liveReason === "processing"
            ? "Live updates active - deal is processing"
            : "Live updates active - user recently acted"
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
      {shouldPoll && liveReason === "processing" && (
        <span className="text-emerald-400/60">
          {processingCount > 0 ? `(${processingCount} processing)` : "(processing)"}
        </span>
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

/**
 * Processing Micro-State
 *
 * Shows a small indicator when uploads/AI are processing.
 * Designed to be pinned near the Next Best Action button.
 */
export function ProcessingIndicator() {
  let processingCount = 0;
  let checklistState: "empty" | "processing" | "ready" = "ready";
  try {
    const ctx = useCockpitDataContext();
    processingCount = ctx.processingUploads;
    checklistState = ctx.checklistSummary?.state || "ready";
  } catch {
    return null; // Not in context
  }

  const isProcessing = processingCount > 0 || checklistState === "processing";
  if (!isProcessing) return null;

  return (
    <div className="flex items-center gap-2 rounded-lg bg-sky-500/10 border border-sky-500/20 px-3 py-2 text-xs text-sky-200">
      <span className="animate-spin material-symbols-outlined text-[16px]">progress_activity</span>
      <span>
        {processingCount > 0
          ? `Processing ${processingCount} upload${processingCount > 1 ? "s" : ""}...`
          : "Processing documents..."}
      </span>
      <span className="text-sky-200/50">(est. &lt;10s)</span>
    </div>
  );
}

/**
 * Toast Stack for "What Changed"
 *
 * Displays toasts when lifecycle state changes (stage advanced, blockers cleared, etc.)
 */
export function CockpitToastStack() {
  let toasts: Array<{ id: string; type: string; title: string; detail?: string; ts: number }> = [];
  let dismissToast: (id: string) => void = () => {};
  try {
    const ctx = useCockpitDataContext();
    toasts = ctx.toasts;
    dismissToast = ctx.dismissToast;
  } catch {
    return null; // Not in context
  }

  if (toasts.length === 0) return null;

  const getToastStyle = (type: string) => {
    switch (type) {
      case "stage_advanced":
        return "border-emerald-500/30 bg-emerald-500/10 text-emerald-100";
      case "blockers_cleared":
        return "border-sky-500/30 bg-sky-500/10 text-sky-100";
      case "doc_classified":
        return "border-violet-500/30 bg-violet-500/10 text-violet-100";
      default:
        return "border-white/10 bg-white/5 text-white/80";
    }
  };

  const getToastIcon = (type: string) => {
    switch (type) {
      case "stage_advanced":
        return "arrow_forward";
      case "blockers_cleared":
        return "check_circle";
      case "doc_classified":
        return "description";
      default:
        return "info";
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[320px] pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={cn(
            "pointer-events-auto animate-in fade-in slide-in-from-right-2 rounded-xl border p-3 shadow-lg backdrop-blur-sm",
            getToastStyle(toast.type)
          )}
        >
          <div className="flex items-start gap-2">
            <span className="material-symbols-outlined text-[18px] mt-0.5">
              {getToastIcon(toast.type)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">{toast.title}</div>
              {toast.detail && (
                <div className="mt-0.5 text-xs opacity-70">{toast.detail}</div>
              )}
            </div>
            <button
              type="button"
              onClick={() => dismissToast(toast.id)}
              className="text-white/40 hover:text-white/80 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
