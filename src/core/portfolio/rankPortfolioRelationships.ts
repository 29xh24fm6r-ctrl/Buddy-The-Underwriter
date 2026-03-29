// Pure function. No DB. No side effects. No network.
import type { PortfolioRelationshipInput, RankedRelationship } from "./types";
import { TIER_ORDER } from "../relationship-decision/types";
import { deriveRelationshipPortfolioScore } from "./deriveRelationshipPortfolioScore";

const TIER_RANK: Record<string, number> = {};
for (let i = 0; i < TIER_ORDER.length; i++) {
  TIER_RANK[TIER_ORDER[i]] = i;
}

/**
 * Rank all relationships deterministically.
 * Step 1: Partition by system tier
 * Step 2: Rank within tier by score descending
 * Step 3: Assign rank positions
 *
 * HARD RULE: Higher tier ALWAYS outranks lower tier.
 */
export function rankPortfolioRelationships(
  inputs: PortfolioRelationshipInput[],
): RankedRelationship[] {
  // Score each relationship
  const scored = inputs.map((input) => ({
    input,
    score: deriveRelationshipPortfolioScore(input),
  }));

  // Sort: tier ascending (more urgent first), then score descending, then lexical ID for stability
  scored.sort((a, b) => {
    const tierA = TIER_RANK[a.input.systemTier] ?? 99;
    const tierB = TIER_RANK[b.input.systemTier] ?? 99;
    if (tierA !== tierB) return tierA - tierB;
    if (a.score !== b.score) return b.score - a.score;
    return a.input.relationshipId.localeCompare(b.input.relationshipId);
  });

  return scored.map((s, idx) => ({
    relationshipId: s.input.relationshipId,
    systemTier: s.input.systemTier,
    rankPosition: idx + 1,
    drivers: {
      distress: s.input.hasDistress,
      deadline: s.input.hasDeadline,
      borrowerBlock: s.input.hasBorrowerBlock,
      protection: s.input.hasProtection,
      growth: s.input.hasGrowth,
      value: s.input.hasHighValue,
    },
    explanation: s.input.whyNow,
    primaryAction: s.input.primaryAction,
  }));
}
