"use client";

import type { BuddyCanonicalState } from "@/core/state/types";

/**
 * Next Action Reason — Phase 65C
 *
 * Shows WHAT the next action is and WHY it is required.
 * 100% Buddy-owned. No Omega input.
 */

const NEXT_ACTION_REASONS: Record<string, string> = {
  "Set Up Intake": "Intake must be configured before documents can be requested",
  "Request Documents": "Borrower documents are needed to begin underwriting",
  "Review Documents": "Documents need review before they can be accepted",
  "Set Pricing Assumptions": "Pricing assumptions are required before underwriting can begin",
  "Start Underwriting": "All documents are satisfied — underwriting can now begin",
  "Complete Underwriting": "Underwriting analysis needs to be completed",
  "Review Credit Memo": "Credit memo must be reviewed before committee submission",
  "Start Closing": "Committee has decided — closing process can begin",
  "Complete Closing": "Closing is in progress and needs to be finalized",
};

export function NextActionReason({ state }: { state: BuddyCanonicalState }) {
  const action = state.nextRequiredAction;
  const reason = NEXT_ACTION_REASONS[action.label] ?? "";

  return (
    <div data-testid="next-action-reason" className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-neutral-900">
          Next: {action.label}
        </span>
        {action.intent === "blocked" && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-700">
            Blocked
          </span>
        )}
      </div>
      {reason && (
        <div className="text-[11px] text-neutral-500">
          Because: {reason}
        </div>
      )}
    </div>
  );
}
