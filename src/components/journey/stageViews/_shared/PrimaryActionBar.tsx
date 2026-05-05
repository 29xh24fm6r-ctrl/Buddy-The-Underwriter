"use client";

import type { NextAction } from "@/buddy/lifecycle/nextAction";
import { toCockpitAction } from "@/lib/journey/getNextAction";
import { useCockpitAction } from "../../actions/useCockpitAction";
import type { CockpitAction } from "../../actions/actionTypes";

/**
 * SPEC-04 — primary action bar.
 *
 * Owns the single "exactly one primary action" contract for a stage view.
 * Accepts the lifecycle `NextAction` (current callers) and converts to a
 * SPEC-04 `CockpitAction` internally before executing through the unified
 * action runner.
 *
 * - intent=navigate → router.push(href) via useCockpitAction
 * - intent=runnable → POST via useCockpitAction
 * - intent=fix_blocker → POST via useCockpitAction
 * - complete / blocked → status chip (no execution)
 *
 * Pending: button disabled + loading state.
 * Failure: inline error chip.
 * Success: stage data refreshed by useCockpitAction.
 */
export function PrimaryActionBar({
  action,
  dealId,
  description,
}: {
  action: NextAction | null;
  dealId: string;
  description?: string | null;
}) {
  const { state, run, clearError } = useCockpitAction(dealId);

  const cockpitAction: CockpitAction | null = action
    ? toCockpitAction(action)
    : null;

  if (!action) {
    return (
      <div
        data-testid="primary-action-bar"
        className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-xs text-white/50"
      >
        No primary action available.
      </div>
    );
  }

  const labelDescription = description ?? action.description;

  if (action.intent === "complete") {
    return (
      <div
        data-testid="primary-action-bar"
        className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3"
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] uppercase tracking-wide text-emerald-300/80">
              Status
            </div>
            <div className="text-sm font-semibold text-emerald-100">{action.label}</div>
            {labelDescription ? (
              <div className="mt-1 text-xs text-emerald-200/70">{labelDescription}</div>
            ) : null}
          </div>
          <span className="material-symbols-outlined text-emerald-300">check_circle</span>
        </div>
      </div>
    );
  }

  if (action.intent === "blocked") {
    return (
      <div
        data-testid="primary-action-bar"
        className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3"
      >
        <div className="text-[10px] uppercase tracking-wide text-amber-300/80">Blocked</div>
        <div className="text-sm font-semibold text-amber-100">{action.label}</div>
        {labelDescription ? (
          <div className="mt-1 text-xs text-amber-200/80">{labelDescription}</div>
        ) : null}
      </div>
    );
  }

  const ACTION_ID = "primary";
  const isPending = state.status === "pending" && state.activeId === ACTION_ID;
  const errorMessage =
    state.status === "error" && state.activeId === ACTION_ID
      ? state.errorMessage
      : null;

  const handleClick = (event: React.MouseEvent) => {
    if (!cockpitAction) return;
    event.preventDefault();
    if (isPending) return;
    void run(cockpitAction, { id: ACTION_ID });
  };

  // Fallback for actions we couldn't convert (e.g. runnable with no
  // supported endpoint and no href). Show a status chip rather than crashing.
  if (!cockpitAction) {
    return (
      <div
        data-testid="primary-action-bar"
        className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3"
      >
        <div className="text-[10px] uppercase tracking-wide text-white/50">Action</div>
        <div className="text-sm font-semibold text-white">{action.label}</div>
        {labelDescription ? (
          <div className="mt-1 text-xs text-white/60">{labelDescription}</div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      data-testid="primary-action-bar"
      className="flex flex-col gap-2 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-wide text-blue-300/80">
          Next action
        </div>
        {labelDescription ? (
          <div className="text-xs text-blue-100/80">{labelDescription}</div>
        ) : null}
        {errorMessage ? (
          <div
            className="mt-1 inline-flex items-center gap-1 rounded-md border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-200"
            data-testid="primary-action-error"
            role="alert"
          >
            <span className="material-symbols-outlined text-[14px]">error</span>
            {errorMessage}
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                clearError();
              }}
              className="ml-1 text-rose-200/80 hover:text-rose-100"
              aria-label="Dismiss error"
            >
              ×
            </button>
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending}
        aria-busy={isPending}
        className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60 self-start sm:self-auto"
        data-testid="primary-action-cta"
      >
        {isPending ? (
          <>
            <span className="material-symbols-outlined text-[18px] animate-spin">
              progress_activity
            </span>
            Running…
          </>
        ) : (
          <>
            {cockpitAction.label}
            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
          </>
        )}
      </button>
    </div>
  );
}
