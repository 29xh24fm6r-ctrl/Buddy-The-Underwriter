// Pure function. No DB. No side effects. No network.
import type { PortfolioRelationshipInput } from "./types";
import { TIER_ORDER } from "../relationship-decision/types";

/**
 * Compute portfolio score for a single relationship.
 * Score is used for within-tier ranking only.
 * Higher tier ALWAYS outranks lower tier regardless of score.
 */
export function deriveRelationshipPortfolioScore(
  input: PortfolioRelationshipInput,
): number {
  return (
    input.severityWeight +
    input.deadlineWeight +
    input.exposureWeight +
    input.evidenceWeight +
    input.policyWeight +
    input.ageWeight
  );
}
