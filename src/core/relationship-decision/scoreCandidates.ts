// Pure function. No DB. No side effects. No network.
import type { DecisionCandidate } from "./types";

/**
 * Score and rank all candidates deterministically.
 * Returns candidates sorted by totalScore descending.
 * Ties broken by: tier > severity > deadline > policy > lexical action code.
 * No randomness. Ever.
 */
export function scoreCandidates(
  candidates: DecisionCandidate[],
): DecisionCandidate[] {
  // Compute total score for each candidate
  const scored = candidates.map((c) => ({
    ...c,
    totalScore:
      c.tierWeight +
      c.severityWeight +
      c.deadlineWeight +
      c.evidenceWeight +
      c.blockerWeight +
      c.relationshipValueWeight +
      c.policyWeight -
      c.freshnessPenalty -
      c.suppressibilityPenalty,
  }));

  // Sort descending by total score, with deterministic tiebreakers
  scored.sort((a, b) => {
    if (a.totalScore !== b.totalScore) return b.totalScore - a.totalScore;
    if (a.tierWeight !== b.tierWeight) return b.tierWeight - a.tierWeight;
    if (a.severityWeight !== b.severityWeight) return b.severityWeight - a.severityWeight;
    if (a.deadlineWeight !== b.deadlineWeight) return b.deadlineWeight - a.deadlineWeight;
    if (a.policyWeight !== b.policyWeight) return b.policyWeight - a.policyWeight;
    // Lexical stable fallback
    return a.actionCode.localeCompare(b.actionCode);
  });

  return scored;
}
