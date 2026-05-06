"use client";

import { useEffect, useState } from "react";
import { useStageDataContext } from "./StageDataProvider";
import type { CockpitActionState } from "../../actions/useCockpitAction";

/**
 * SPEC-05 — standardized action feedback chip.
 *
 * Renders pending / success / error states tied to a specific action id,
 * an optional optimistic message that displays immediately on success
 * (before canonical refresh completes), and a "last refreshed" timestamp
 * sourced from the StageDataProvider.
 *
 * Hides itself entirely when there's nothing to show.
 */
export type ActionFeedbackProps = {
  /** Identity used to filter useCockpitAction state. */
  actionId: string;
  state: CockpitActionState;
  /** Label of the action being run / just run. */
  actionLabel?: string | null;
  /**
   * Optional message rendered right after a successful run, before the
   * canonical refresh completes (e.g. "Packet generation started").
   */
  optimisticMessage?: string | null;
  /** Show the global "last refreshed" timestamp regardless of action state. */
  showRefreshedAt?: boolean;
};

const SUCCESS_VISIBLE_MS = 4_000;

export function ActionFeedback({
  actionId,
  state,
  actionLabel,
  optimisticMessage,
  showRefreshedAt = false,
}: ActionFeedbackProps) {
  const { lastRefreshedAt } = useStageDataContext();

  const isMine = state.activeId === actionId;
  const status = isMine ? state.status : "idle";
  const errorMessage = isMine ? state.errorMessage : null;

  // Auto-fade the success chip after SUCCESS_VISIBLE_MS. The cleanup
  // function flips back to false on status change so the timeout never
  // leaks across status transitions.
  const [hideSuccess, setHideSuccess] = useState(false);
  useEffect(() => {
    if (status !== "success") return;
    const t = setTimeout(() => setHideSuccess(true), SUCCESS_VISIBLE_MS);
    return () => {
      clearTimeout(t);
      setHideSuccess(false);
    };
  }, [status]);

  const visibleStatus = status === "success" && hideSuccess ? "idle" : status;

  if (visibleStatus === "idle" && !showRefreshedAt) return null;
  if (visibleStatus === "idle" && lastRefreshedAt === 0) return null;

  return (
    <div
      data-testid="action-feedback"
      data-status={visibleStatus}
      data-action-id={actionId}
      className="mt-1 inline-flex flex-wrap items-center gap-2 text-[11px]"
      aria-live="polite"
    >
      {visibleStatus === "pending" ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-blue-200">
          <span className="material-symbols-outlined text-[12px] animate-spin">
            progress_activity
          </span>
          Running{actionLabel ? ` · ${actionLabel}` : ""}…
        </span>
      ) : null}

      {visibleStatus === "success" ? (
        <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-emerald-200">
          <span className="material-symbols-outlined text-[12px]">check</span>
          {optimisticMessage ?? `Done${actionLabel ? ` · ${actionLabel}` : ""}`}
        </span>
      ) : null}

      {visibleStatus === "error" ? (
        <span
          className="inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-rose-200"
          role="alert"
        >
          <span className="material-symbols-outlined text-[12px]">error</span>
          {actionLabel ? `${actionLabel} failed` : "Failed"}
          {errorMessage ? ` · ${errorMessage}` : ""}
        </span>
      ) : null}

      {showRefreshedAt && lastRefreshedAt > 0 ? (
        <span className="text-white/40" data-testid="action-feedback-refreshed-at">
          Refreshed {formatRelativeTime(lastRefreshedAt)}
        </span>
      ) : null}
    </div>
  );
}

function formatRelativeTime(epochMs: number): string {
  const delta = Date.now() - epochMs;
  if (delta < 5_000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1_000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return new Date(epochMs).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Default optimistic-message map for the four ServerActionTypes.
 * Imported by panels that surface runnable actions.
 */
export const OPTIMISTIC_MESSAGES: Record<string, string> = {
  generate_packet: "Packet generation started — refreshing…",
  generate_snapshot: "Snapshot recompute requested — refreshing…",
  run_ai_classification: "Classification queued — refreshing…",
  send_reminder: "Reminder sent.",
};
