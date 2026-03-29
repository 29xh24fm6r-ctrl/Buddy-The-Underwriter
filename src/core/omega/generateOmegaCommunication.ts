import "server-only";

import { callOmegaGemini, safeParseJSON } from "./omegaGeminiClient";
import type { OmegaRelationshipContext, OmegaCommunication } from "./relationshipAdvisoryTypes";

const FALLBACK: OmegaCommunication = {
  borrowerMessage: { subject: "", body: "" },
  internalNote: { summary: "", bullets: [] },
};

/**
 * Generate borrower-safe message and internal note.
 * Borrower message: no internal jargon, no risk grades, no system terminology.
 * Internal note: concise, factual, action-oriented.
 */
export async function generateOmegaCommunication(
  ctx: OmegaRelationshipContext,
): Promise<OmegaCommunication> {
  const prompt = `You are an AI banking advisor drafting communications for a commercial banker.
Generate TWO outputs:

1. BORROWER MESSAGE — Professional, warm, clear. No internal jargon, no risk grades, no system terminology, no mention of watchlist/workout/distress. Focus on what the borrower needs to know or do.

2. INTERNAL NOTE — Concise factual summary for the banker's file. Include key metrics, blockers, and recommended next steps.

RULES:
- Do NOT invent facts. Only use provided inputs.
- Only reference facts from provided inputs.
- Borrower message must NEVER mention: risk score, watchlist, workout, distress, liquidation, internal systems.
- Internal note should be direct and actionable.

STATE: ${ctx.canonicalFacts.relationshipState}
HEALTH: ${ctx.canonicalFacts.health}
PRIMARY REASON: ${ctx.relationship.primaryReasonLabel}
PRIMARY ACTION: ${ctx.relationship.primaryActionLabel ?? "None"}
BLOCKERS: ${JSON.stringify(ctx.canonicalFacts.blockers)}
OPEN CASES: ${ctx.openCases.map((c) => `${c.caseType} (${c.status})`).join(", ") || "None"}

Return ONLY valid JSON:
{
  "borrowerMessage": {
    "subject": "email subject line",
    "body": "email body (2-3 paragraphs)"
  },
  "internalNote": {
    "summary": "one sentence summary",
    "bullets": ["key point 1", "key point 2", "key point 3"]
  }
}`;

  try {
    const text = await callOmegaGemini(prompt);
    return safeParseJSON(text, FALLBACK);
  } catch (err) {
    console.error("[generateOmegaCommunication] error:", err);
    return FALLBACK;
  }
}
