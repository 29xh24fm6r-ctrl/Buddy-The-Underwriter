/**
 * SPEC-FINANCIAL-READINESS-GCF-PREREQ-REPAIR-1 (Phase: orphan UI recovery)
 *
 * Pure UI gate for the Global Cash Flow Compute / Retry action. Kept free of any
 * "server-only" barrier so the client GCF page can import it directly and a unit
 * test can pin the behavior without a DOM.
 *
 * Background — the recovery dead-end this fixes:
 *   The GCF page reads the canonical contract on a plain GET, which does NOT run
 *   the deterministic prerequisite repair. So a deal whose only gaps are the
 *   repairable ones (ANNUAL_DEBT_SERVICE from current structural pricing, PFS
 *   facts from accepted payments) loads with prerequisitesReady === false and
 *   therefore computeBlocked === true. The repair only runs inside the recompute
 *   POST — but if the Retry button is disabled purely on computeBlocked, the user
 *   can never trigger the POST. An ORPHANED_BY_FAILED_ORCHESTRATION GLOBAL row
 *   then becomes a permanent dead-end.
 *
 * Rule:
 *   - While a compute is in flight (recomputing / isComputing) the action is
 *     never offered (avoid duplicate jobs).
 *   - An ORPHANED row must always remain retryable: the recompute POST runs the
 *     repair first and then either succeeds or re-surfaces precise diagnostics —
 *     it never forces success and the server gate still fail-closes (it refuses to
 *     enqueue GCF when prerequisites are genuinely missing). So clicking Retry on
 *     an orphan can only RECOVER or re-explain, never fake success.
 *   - Otherwise (a normal never-computed / errored row), keep steering the banker
 *     upstream when computeBlocked.
 */

export type GcfRecomputeGateInput = {
  /** A compute request this client just issued is still resolving. */
  recomputing: boolean;
  /** The GLOBAL row is queued/generating (a compute is already in flight). */
  isComputing: boolean;
  /** Canonical prerequisitesReady === false (downstream-gated). */
  computeBlocked: boolean;
  /**
   * The current GLOBAL spread row is an orphan
   * (error_code === "ORPHANED_BY_FAILED_ORCHESTRATION").
   */
  isOrphanedRow: boolean;
};

export const ORPHANED_BY_FAILED_ORCHESTRATION = "ORPHANED_BY_FAILED_ORCHESTRATION";

/**
 * Whether the Compute / Retry action may run for the current GCF state.
 * Returns false while a compute is in flight; true for an orphaned row even when
 * computeBlocked (so the only recovery path stays runnable); otherwise the
 * inverse of computeBlocked.
 */
export function canRunGcfRecompute(input: GcfRecomputeGateInput): boolean {
  if (input.recomputing || input.isComputing) return false;
  if (input.isOrphanedRow) return true;
  return !input.computeBlocked;
}
