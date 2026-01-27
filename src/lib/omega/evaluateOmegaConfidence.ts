/**
 * Omega Confidence Delegation.
 *
 * Asks Omega to evaluate confidence for an underwriting case.
 * Returns a recommendation that Buddy uses for lifecycle gating.
 *
 * Rule: Buddy enforces. Omega decides.
 *
 * Server-only.
 */
import "server-only";

import { invokeOmega } from "./invokeOmega";
import { omegaEntityUri } from "./uri";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface OmegaConfidenceResult {
  ok: boolean;
  confidence?: number; // 0.0–1.0
  recommendation?: "proceed" | "clarify" | "block";
  explanation?: string;
}

export interface EvaluateConfidenceOpts {
  underwritingCaseId: string; // dealId
  correlationId: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate confidence for an underwriting case via Omega.
 *
 * - Sends entity URI + constraint namespaces (no raw metrics)
 * - Returns confidence + recommendation
 * - On failure, returns { ok: false } — caller falls back to local logic
 */
export async function evaluateOmegaConfidence(
  opts: EvaluateConfidenceOpts,
): Promise<OmegaConfidenceResult> {
  const { underwritingCaseId, correlationId } = opts;

  const entityUri = omegaEntityUri("underwriting_case", underwritingCaseId);

  const result = await invokeOmega<{
    confidence: number;
    recommendation: "proceed" | "clarify" | "block";
    explanation?: string;
  }>({
    resource: "omega://confidence/evaluate",
    correlationId,
    payload: {
      entity_uri: entityUri,
      constraint_namespaces: [
        "buddy/underwriting",
        "buddy/model_governance",
      ],
    },
  });

  if (!result.ok) {
    return { ok: false };
  }

  return {
    ok: true,
    confidence: result.data.confidence,
    recommendation: result.data.recommendation,
    explanation: result.data.explanation,
  };
}
