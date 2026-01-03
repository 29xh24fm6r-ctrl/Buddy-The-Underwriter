import type { DealMode } from "./dealMode";

/**
 * deriveDealMode
 *
 * Canonical convergence state resolver.
 * This value is NEVER stored in the database — it is always derived live.
 *
 * Priority order (highest → lowest):
 * 1. blocked      – hard system or validation blocker
 * 2. processing   – uploads / OCR / pipeline actively running
 * 3. initializing – checklist empty, system converging
 * 4. needs_input  – user action required
 * 5. ready        – all conditions satisfied
 */
export function deriveDealMode({
  checklist,
  pipeline,
  uploads,
}: {
  checklist: {
    state: "empty" | "ready";
    pendingCount: number;
  };
  pipeline?: {
    status?: "blocked" | "completed" | string;
  };
  uploads?: {
    processing?: number;
  };
}): DealMode {
  // 1. Hard blocker always wins
  if (pipeline?.status === "blocked") {
    return "blocked";
  }

  // 2. System actively working
  if ((uploads?.processing ?? 0) > 0) {
    return "processing";
  }

  // 3. Empty checklist → initializing
  if (checklist.state === "empty") {
    return "initializing";
  }

  // 4. Missing required items → needs input
  if (checklist.pendingCount > 0) {
    return "needs_input";
  }

  // 5. Everything satisfied
  return "ready";
}
