/**
 * Outcome-Aware Narratives — Phase 66C
 *
 * Generates narratives that incorporate historical outcome data
 * to build trust and context for recommendations.
 * Pure function, no DB or server deps.
 */

type OutcomeContext = {
  acceptanceRate: number; // 0-1
  impactRate: number; // 0-1
  similarDealsHelped: number; // count
};

type OutcomeBadge = {
  label: string;
  color: string;
};

/**
 * Appends outcome context to an existing narrative.
 *
 * Only appends if acceptance rate is high enough to be meaningful.
 */
export function enrichNarrativeWithOutcomes(
  narrative: string,
  outcomes: OutcomeContext,
): string {
  if (outcomes.acceptanceRate >= 0.7 && outcomes.similarDealsHelped > 0) {
    const helped = outcomes.similarDealsHelped;
    const total = Math.round(helped / outcomes.acceptanceRate);
    return `${narrative} Similar recommendations helped ${helped} out of ${total} deals.`;
  }

  if (outcomes.impactRate >= 0.6 && outcomes.similarDealsHelped > 0) {
    return `${narrative} This type of recommendation has shown positive impact in ${Math.round(outcomes.impactRate * 100)}% of similar deals.`;
  }

  return narrative;
}

/**
 * Generates a badge based on historical effectiveness.
 *
 * - Both >= 0.8 => "Proven Effective" (green)
 * - Either >= 0.6 => "Historically Useful" (blue)
 * - Else => "New Recommendation" (gray)
 */
export function generateOutcomeBadge(
  acceptanceRate: number,
  impactRate: number,
): OutcomeBadge {
  if (acceptanceRate >= 0.8 && impactRate >= 0.8) {
    return { label: "Proven Effective", color: "green" };
  }
  if (acceptanceRate >= 0.6 || impactRate >= 0.6) {
    return { label: "Historically Useful", color: "blue" };
  }
  return { label: "New Recommendation", color: "gray" };
}
