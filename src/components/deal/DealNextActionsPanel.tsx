"use client";

import { useState, useCallback } from "react";
import type { BuddyNextAction, BuddyActionCode } from "@/core/actions/types";
import type { CanonicalExecutionStatus } from "@/core/actions/execution/types";

/**
 * DealNextActionsPanel — Phase 65D + 65E
 *
 * Renders canonical next actions with execution affordance.
 * Executable actions show a button; task-only actions show "Mark as Started".
 * no_action_required shows no button.
 */

const PRIORITY_STYLES: Record<string, string> = {
  critical: "border-red-200 bg-red-50 text-red-800",
  high: "border-amber-200 bg-amber-50 text-amber-800",
  normal: "border-neutral-200 bg-neutral-50 text-neutral-700",
};

/** Actions that should not show an execute button */
const NO_BUTTON_ACTIONS: Set<BuddyActionCode> = new Set(["no_action_required"]);

/** Human-readable execution result labels */
const STATUS_LABELS: Record<CanonicalExecutionStatus, string> = {
  created: "Executed",
  queued: "Queued",
  already_exists: "Already exists",
  noop: "No action needed",
  failed: "Failed",
};

/** Button label by action code */
function getButtonLabel(code: BuddyActionCode): string {
  switch (code) {
    case "request_documents":
    case "seed_checklist":
    case "run_extraction":
    case "generate_financial_snapshot":
      return "Execute";
    default:
      return "Mark as Started";
  }
}

type ExecutionFeedback = {
  actionCode: BuddyActionCode;
  status: CanonicalExecutionStatus;
};

export function DealNextActionsPanel({
  dealId,
  nextActions,
  primaryAction,
  onActionsRefreshed,
}: {
  dealId: string;
  nextActions: BuddyNextAction[];
  primaryAction: BuddyNextAction | null;
  onActionsRefreshed?: (payload: {
    nextActions: BuddyNextAction[];
    primaryAction: BuddyNextAction | null;
  }) => void;
}) {
  const [executing, setExecuting] = useState<BuddyActionCode | null>(null);
  const [feedback, setFeedback] = useState<ExecutionFeedback | null>(null);

  const handleExecute = useCallback(
    async (code: BuddyActionCode) => {
      setExecuting(code);
      setFeedback(null);
      try {
        const res = await fetch(`/api/deals/${dealId}/actions/execute`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actionCode: code }),
        });
        const json = await res.json();
        if (json.ok) {
          setFeedback({ actionCode: code, status: json.result.status });
          if (json.refreshed && onActionsRefreshed) {
            onActionsRefreshed({
              nextActions: json.refreshed.nextActions,
              primaryAction: json.refreshed.primaryAction,
            });
          }
        } else {
          setFeedback({ actionCode: code, status: "failed" });
        }
      } catch {
        setFeedback({ actionCode: code, status: "failed" });
      } finally {
        setExecuting(null);
      }
    },
    [dealId, onActionsRefreshed],
  );

  if (nextActions.length === 0) return null;

  return (
    <section data-testid="deal-next-actions-panel" data-buddy-actions="true" className="rounded-xl border border-neutral-200 bg-white p-4 space-y-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
        What Needs to Happen Next
      </div>

      {primaryAction && (
        <div
          data-primary-action="true"
          className={`rounded-lg border p-3 ${PRIORITY_STYLES[primaryAction.priority] ?? PRIORITY_STYLES.normal}`}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold">{primaryAction.label}</span>
              <span className="rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase">
                {primaryAction.priority}
              </span>
            </div>
            <ActionButton
              code={primaryAction.code}
              executing={executing}
              feedback={feedback}
              onExecute={handleExecute}
            />
          </div>
          <div className="mt-1 text-xs opacity-80">{primaryAction.description}</div>
        </div>
      )}

      {nextActions.length > 1 && (
        <ul className="space-y-1.5">
          {nextActions.slice(1).map((action) => (
            <li key={action.code} className="flex items-start justify-between gap-2 text-xs text-neutral-700">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-neutral-300" />
                <div>
                  <span className="font-medium">{action.label}</span>
                  <span className="text-neutral-500"> — {action.description}</span>
                </div>
              </div>
              <ActionButton
                code={action.code}
                executing={executing}
                feedback={feedback}
                onExecute={handleExecute}
                small
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ActionButton({
  code,
  executing,
  feedback,
  onExecute,
  small,
}: {
  code: BuddyActionCode;
  executing: BuddyActionCode | null;
  feedback: ExecutionFeedback | null;
  onExecute: (code: BuddyActionCode) => void;
  small?: boolean;
}) {
  if (NO_BUTTON_ACTIONS.has(code)) return null;

  const isExecuting = executing === code;
  const hasFeedback = feedback?.actionCode === code;
  const isDisabled = executing !== null;

  if (hasFeedback && feedback) {
    return (
      <span
        className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-medium ${
          feedback.status === "failed"
            ? "bg-red-100 text-red-700"
            : "bg-green-100 text-green-700"
        }`}
      >
        {STATUS_LABELS[feedback.status]}
      </span>
    );
  }

  return (
    <button
      type="button"
      disabled={isDisabled}
      onClick={() => onExecute(code)}
      className={`shrink-0 rounded border border-neutral-300 bg-white font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 disabled:cursor-not-allowed ${
        small ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs"
      }`}
    >
      {isExecuting ? "..." : getButtonLabel(code)}
    </button>
  );
}
