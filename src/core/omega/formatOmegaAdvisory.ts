/**
 * Omega Advisory Formatter — Phase 65C
 *
 * Formats raw Omega output into clean, banker-readable text.
 * Separate from Buddy explanation — these never mix.
 */

import type { OmegaAdvisoryState } from "./types";
import type { OmegaExplanation } from "@/core/explanation/types";

export function formatOmegaAdvisory(omega: OmegaAdvisoryState): OmegaExplanation {
  const advisorySummary = omega.advisory
    ? omega.advisory.length > 200
      ? omega.advisory.slice(0, 197) + "..."
      : omega.advisory
    : omega.stale
      ? "Advisory intelligence is currently unavailable."
      : "No advisory available for this deal.";

  return {
    advisorySummary,
    confidence: omega.confidence,
    signals: omega.riskEmphasis,
    traceRef: omega.traceRef ?? undefined,
    stale: omega.stale,
  };
}
