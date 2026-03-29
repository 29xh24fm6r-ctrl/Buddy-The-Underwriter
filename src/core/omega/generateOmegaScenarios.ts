import "server-only";

import { callOmegaGemini, safeParseJSON } from "./omegaGeminiClient";
import type { OmegaRelationshipContext, OmegaScenario } from "./relationshipAdvisoryTypes";

/**
 * Generate bounded scenario analysis.
 * Constrained by facts — no speculation beyond evidence.
 */
export async function generateOmegaScenarios(
  ctx: OmegaRelationshipContext,
): Promise<OmegaScenario[]> {
  const prompt = `You are an AI banking advisor generating scenario analysis for a commercial banker.
Generate exactly 3 scenarios: base case, upside, downside.
RULES:
- Scenarios must be grounded in the provided facts. Do NOT invent facts.
- Do NOT invent external market events or statistics.
- Likelihood must be realistic given evidence.
- Be concise — one sentence per field.

STATE: ${ctx.canonicalFacts.relationshipState}
HEALTH: ${ctx.canonicalFacts.health}
BLOCKERS: ${JSON.stringify(ctx.canonicalFacts.blockers)}
SIGNALS: ${JSON.stringify(ctx.signals)}
EVIDENCE TYPES: ${[...new Set(ctx.evidence.map((e) => e.sourceLayer))].join(", ") || "None"}
OPEN CASES: ${ctx.openCases.map((c) => `${c.caseType} (${c.status})`).join(", ") || "None"}

Return ONLY valid JSON array:
[
  { "scenario": "Base case", "outcome": "expected outcome", "likelihood": "high" },
  { "scenario": "Upside", "outcome": "positive outcome", "likelihood": "medium" | "low" },
  { "scenario": "Downside", "outcome": "negative outcome", "likelihood": "medium" | "low" }
]`;

  try {
    const text = await callOmegaGemini(prompt);
    const parsed = safeParseJSON<OmegaScenario[]>(text, []);
    return Array.isArray(parsed) ? parsed.slice(0, 3) : [];
  } catch (err) {
    console.error("[generateOmegaScenarios] error:", err);
    return [];
  }
}
