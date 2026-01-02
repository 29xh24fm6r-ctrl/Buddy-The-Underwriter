/**
 * 🎯 DERIVED PIPELINE STAGE
 * 
 * Pipeline stage is NO LONGER stored or manually mutated.
 * It's ALWAYS derived from canonical state:
 * 
 * - submitted_at IS NOT NULL → "submitted"
 * - ready_at IS NOT NULL → "ready"
 * - Otherwise → "collecting"
 * 
 * This ensures:
 * ✅ Single source of truth (ready_at, submitted_at)
 * ✅ Impossible to desync
 * ✅ No manual stage transitions
 */

export type PipelineStage = "collecting" | "ready" | "submitted";

export type PipelineCheckableDeal = {
  ready_at: string | null;
  submitted_at: string | null;
};

/**
 * Derive pipeline stage from canonical state
 * 
 * @example
 * const deal = await getDeal(dealId);
 * const stage = derivePipelineStage(deal);
 * // stage = "ready" | "submitted" | "collecting"
 */
export function derivePipelineStage(deal: PipelineCheckableDeal): PipelineStage {
  if (deal.submitted_at) {
    return "submitted";
  }
  
  if (deal.ready_at) {
    return "ready";
  }
  
  return "collecting";
}

/**
 * Get human-readable pipeline status
 */
export function derivePipelineStatus(deal: PipelineCheckableDeal & { ready_reason?: string | null }): string {
  const stage = derivePipelineStage(deal);
  
  switch (stage) {
    case "submitted":
      return "Submitted to lender";
    case "ready":
      return "Ready for submission";
    case "collecting":
      return deal.ready_reason || "Collecting documents";
  }
}
