import "server-only";

import { callOmegaGemini, safeParseJSON } from "./omegaGeminiClient";
import type { OmegaRelationshipContext, OmegaRecommendation } from "./relationshipAdvisoryTypes";

/**
 * Suggest actions — maps to canonical actions when possible.
 * Advisory only. Never executes.
 */
export async function generateOmegaRecommendations(
  ctx: OmegaRelationshipContext,
): Promise<OmegaRecommendation[]> {
  const prompt = `You are an AI banking advisor suggesting next actions for a commercial banker managing a relationship.
RULES:
- Suggest up to 3 actions, ordered by priority.
- Map to canonical system actions when possible (provided in NEXT ACTIONS).
- Do NOT invent facts or capabilities not present in the system.
- Do NOT suggest actions that contradict the system state.
- Do NOT suggest executing anything directly — these are advisory only.
- Be specific and actionable.

STATE: ${ctx.canonicalFacts.relationshipState}
HEALTH: ${ctx.canonicalFacts.health}
BLOCKERS: ${JSON.stringify(ctx.canonicalFacts.blockers)}
CANONICAL NEXT ACTIONS: ${JSON.stringify(ctx.canonicalFacts.nextActions)}
PRIMARY SYSTEM ACTION: ${ctx.relationship.primaryActionLabel ?? "None"}
OPEN CASES: ${ctx.openCases.map((c) => `${c.caseType} (${c.status})`).join(", ") || "None"}

Return ONLY valid JSON array:
[
  {
    "action": "what to do",
    "reasoning": "why this matters",
    "priority": "high" | "medium" | "low",
    "relatedCanonicalAction": "matching system action code or null"
  }
]`;

  try {
    const text = await callOmegaGemini(prompt);
    const parsed = safeParseJSON<OmegaRecommendation[]>(text, []);
    return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  } catch (err) {
    console.error("[generateOmegaRecommendations] error:", err);
    return [];
  }
}
