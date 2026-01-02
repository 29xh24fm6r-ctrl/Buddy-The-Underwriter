/**
 * assertDealReady — Submission Gate
 * 
 * Enforces the canonical readiness invariant:
 * - Deals can ONLY be submitted if ready_at IS NOT NULL
 * - No exceptions, no overrides, no user decisions
 * 
 * This is called server-side before any submission/packaging operation.
 */

export type ReadyCheckableDeal = {
  ready_at: string | null;
  ready_reason: string | null;
};

/**
 * Throws if deal is not ready
 * 
 * @throws Error with human-readable reason if not ready
 */
export function assertDealReady(deal: ReadyCheckableDeal): asserts deal is ReadyCheckableDeal & { ready_at: string } {
  if (!deal.ready_at) {
    throw new Error(
      deal.ready_reason ?? "Deal is not ready for submission"
    );
  }
}

/**
 * Boolean check (non-throwing) for conditional logic
 */
export function isDealReady(deal: ReadyCheckableDeal): deal is ReadyCheckableDeal & { ready_at: string } {
  return deal.ready_at !== null;
}
