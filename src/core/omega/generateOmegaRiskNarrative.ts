import "server-only";

import { callOmegaGemini, safeParseJSON } from "./omegaGeminiClient";
import type { OmegaRelationshipContext, OmegaRiskNarrative } from "./relationshipAdvisoryTypes";

const FALLBACK: OmegaRiskNarrative = {
  currentRisk: "Risk narrative unavailable.",
  forwardRisk: "",
  keyUncertainties: [],
};

/**
 * Generate forward-looking risk narrative constrained by facts.
 */
export async function generateOmegaRiskNarrative(
  ctx: OmegaRelationshipContext,
): Promise<OmegaRiskNarrative> {
  const prompt = `You are an AI banking advisor writing a risk assessment for a commercial banker.
RULES:
- Assess current risk and forward risk based ONLY on provided evidence.
- Do NOT invent statistics or market data.
- Do NOT use language like "approved", "denied", "creditworthy", or "risk grade".
- Identify key uncertainties honestly.
- Be concise and professional.

STATE: ${ctx.canonicalFacts.relationshipState}
HEALTH: ${ctx.canonicalFacts.health}
BLOCKERS: ${JSON.stringify(ctx.canonicalFacts.blockers)}
EVIDENCE COUNT: ${ctx.evidence.length}
EVIDENCE TYPES: ${[...new Set(ctx.evidence.map((e) => e.sourceLayer))].join(", ") || "None"}
SIGNALS: ${JSON.stringify(ctx.signals)}
OPEN CASES: ${ctx.openCases.map((c) => `${c.caseType} (${c.status})`).join(", ") || "None"}

Return ONLY valid JSON:
{
  "currentRisk": "1-2 sentences on current risk posture",
  "forwardRisk": "1-2 sentences on what could change",
  "keyUncertainties": ["uncertainty 1", "uncertainty 2"]
}`;

  try {
    const text = await callOmegaGemini(prompt);
    return safeParseJSON(text, FALLBACK);
  } catch (err) {
    console.error("[generateOmegaRiskNarrative] error:", err);
    return FALLBACK;
  }
}
