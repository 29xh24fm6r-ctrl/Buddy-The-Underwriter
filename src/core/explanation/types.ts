/**
 * Explanation Types — Phase 65C
 *
 * Buddy explains state. Omega explains reasoning.
 * These two NEVER mix.
 */

/** Deterministic explanation from Buddy's canonical state */
export type BuddyExplanation = {
  /** One-sentence summary of current deal state */
  summary: string;
  /** Why the deal is in this state */
  reasons: string[];
  /** What is currently blocking progress */
  blockingFactors: string[];
  /** Supporting facts from the system */
  supportingFacts: string[];
};

/** Formatted Omega advisory (separate from Buddy explanation) */
export type OmegaExplanation = {
  advisorySummary: string;
  confidence: number;
  signals: string[];
  traceRef?: string;
  stale: boolean;
};
