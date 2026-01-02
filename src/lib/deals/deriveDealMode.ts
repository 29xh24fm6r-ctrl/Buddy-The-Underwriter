import type { DealMode } from "./dealMode";

/**
 * deriveDealMode - Compute current deal mode from system state
 * 
 * This is the canonical truth function for deal convergence state.
 * NEVER store this value - always derive it fresh.
 * 
 * Priority order (highest to lowest):
 * 1. blocked - pipeline explicitly blocked
 * 2. processing - uploads currently processing
 * 3. initializing - empty checklist (system converging)
 * 4. needs_input - checklist has pending items
 * 5. ready - all conditions met
 */
export function deriveDealMode({
  checklist,
  pipeline,
  uploads,
}: {
  checklist: {
    state: "empty" | "ready";
    pending: number;
  };
  pipeline?: {
    status?: "blocked" | "completed" | string;
  };
  uploads?: {
    processing?: number;
  };
}): DealMode {
  // Hard blocker takes priority
  if (pipeline?.status === "blocked") {
    return "blocked";
  }

  // Processing uploads - system working
  if (uploads?.processing && uploads.processing > 0) {
    return "processing";
  }

  // Empty checklist - system initializing
  if (checklist.state === "empty") {
    return "initializing";
  }

  // Has pending items - user action required
  if (checklist.pending > 0) {
    return "needs_input";
  }

  // All clear - ready to proceed
  return "ready";
}
