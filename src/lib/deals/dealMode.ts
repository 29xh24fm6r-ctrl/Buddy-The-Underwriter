/**
 * DealMode - Derived convergence state (never stored in DB)
 * 
 * Represents the current state of a deal in the convergence pipeline.
 * Derived from checklist state, pipeline status, and upload processing state.
 */
export type DealMode =
  | "initializing"   // Empty checklist, system converging
  | "needs_input"    // Checklist incomplete, user action required
  | "processing"     // Uploads in-flight, system working
  | "ready"          // All conditions met, can proceed
  | "blocked";       // Hard blocker, attention required
