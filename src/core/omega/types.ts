/**
 * Omega Advisory Types — Phase 65A
 *
 * Omega annotates. Buddy decides.
 * OmegaAdvisoryState is READ-ONLY advisory intelligence.
 * It may NEVER mutate state, trigger transitions, or suppress required actions.
 */

export type OmegaAdvisoryState = {
  /** Confidence score 0-100. -1 if unavailable. */
  confidence: number;
  /** Human-readable advisory recommendation */
  advisory: string;
  /** Risk signals Omega emphasizes */
  riskEmphasis: string[];
  /** Reference to Omega reasoning trace (builder-only) */
  traceRef: string | null;
  /** True if Omega data is stale or unavailable */
  stale: boolean;
  /** Reason for stale state if applicable */
  staleReason?: string;
};
