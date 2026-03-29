import "server-only";

import { callOmegaGemini, safeParseJSON } from "./omegaGeminiClient";
import type { OmegaRelationshipContext, OmegaRelationshipExplanation } from "./relationshipAdvisoryTypes";

const FALLBACK: OmegaRelationshipExplanation = {
  summary: "Advisory explanation unavailable.",
  keyDrivers: [],
  whatChanged: [],
};

/**
 * Generate a human-readable explanation of the current relationship state.
 * Grounded in evidence — no invented facts.
 */
export async function generateOmegaExplanation(
  ctx: OmegaRelationshipContext,
): Promise<OmegaRelationshipExplanation> {
  const prompt = `You are an AI banking advisor explaining a relationship's current state to a commercial banker.
RULES:
- Only use facts from the provided inputs. Do NOT invent facts.
- Do NOT speculate beyond what the evidence shows.
- Do NOT contradict the canonical state.
- Be concise, professional, grounded.

RELATIONSHIP STATE: ${ctx.canonicalFacts.relationshipState}
HEALTH: ${ctx.canonicalFacts.health}
BLOCKERS: ${JSON.stringify(ctx.canonicalFacts.blockers)}
NEXT ACTIONS: ${JSON.stringify(ctx.canonicalFacts.nextActions)}
PRIMARY REASON: ${ctx.relationship.primaryReasonLabel}
EXPLANATION LINES: ${JSON.stringify(ctx.relationship.explanationLines)}
EVIDENCE COUNT: ${ctx.evidence.length}
OPEN CASES: ${ctx.openCases.map((c) => `${c.caseType} (${c.status})`).join(", ") || "None"}
RECENT TIMELINE: ${ctx.timeline.slice(0, 5).map((t) => `${t.title}: ${t.summary}`).join("; ") || "None"}

Return ONLY valid JSON:
{
  "summary": "1-2 sentence explanation of what is happening and why",
  "keyDrivers": ["driver 1", "driver 2", "driver 3"],
  "whatChanged": ["recent change 1", "recent change 2"]
}`;

  try {
    const text = await callOmegaGemini(prompt);
    return safeParseJSON(text, FALLBACK);
  } catch (err) {
    console.error("[generateOmegaExplanation] error:", err);
    return FALLBACK;
  }
}
