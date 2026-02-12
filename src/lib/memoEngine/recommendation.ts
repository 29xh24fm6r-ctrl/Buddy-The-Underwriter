/**
 * Memo Engine — Recommendation Logic
 *
 * Maps risk tier to recommendation type and descriptive text.
 *
 * PHASE 6: Pure mapping — no DB, no side effects.
 */

import type { RiskTier } from "@/lib/policyEngine/types";
import type { RecommendationType } from "./types";

// ---------------------------------------------------------------------------
// Tier → Recommendation
// ---------------------------------------------------------------------------

interface RecommendationMapping {
  type: RecommendationType;
  text: string;
}

const RECOMMENDATION_MAP: Record<RiskTier, RecommendationMapping> = {
  A: {
    type: "APPROVE",
    text: "Approve subject to standard conditions.",
  },
  B: {
    type: "APPROVE",
    text: "Approve subject to standard conditions.",
  },
  C: {
    type: "APPROVE_WITH_MITIGANTS",
    text: "Approve with mitigants. Additional conditions and monitoring recommended.",
  },
  D: {
    type: "DECLINE_OR_RESTRUCTURE",
    text: "Decline or restructure. Credit profile does not meet minimum institutional standards.",
  },
};

/**
 * Get the recommendation for a given risk tier.
 */
export function getRecommendation(tier: RiskTier): RecommendationMapping {
  return RECOMMENDATION_MAP[tier];
}
