import "server-only";

export type TranscriptCandidate = {
  fact_type: string;
  fact_key: string;
  value: string | number;
  confidence: number;
  snippet: string;
  owner_name?: string;
};

/**
 * Uses Gemini Flash to extract objective, verifiable facts from
 * an AI-generated meeting transcript or call notes.
 *
 * IMPORTANT: Only extracts objective facts — no subjective impressions.
 * The prompt explicitly instructs the model to skip qualitative assessments.
 */
export async function extractFactsFromTranscript(args: {
  rawText: string;
  dealId: string;
}): Promise<{ ok: true; candidates: TranscriptCandidate[] } | { ok: false; error: string }> {
  try {
    const { aiJson } = await import("@/lib/ai/openai");

    const structureHint = `
{
  "candidates": [
    {
      "fact_type": "FINANCIAL | ENTITY | COLLATERAL | LOAN_REQUEST",
      "fact_key": "canonical key e.g. TOTAL_REVENUE, BUSINESS_START_DATE, OWNER_NAME",
      "value": "extracted value — number or string",
      "confidence": 0.0 to 1.0,
      "snippet": "exact quote from transcript supporting this fact",
      "owner_name": "person or entity name if this fact belongs to a specific owner"
    }
  ]
}`;

    const systemPrompt = `You are a fact extraction engine for a commercial bank credit system.

Extract ONLY objective, verifiable facts from the following meeting transcript or call notes.

STRICT RULES:
- Extract ONLY facts that can be documented in a credit file
- DO NOT extract subjective impressions (e.g. "borrower seems trustworthy", "management presents well")
- DO NOT extract predictions or opinions
- DO extract: dollar amounts, dates, percentages, names of entities/people, addresses, counts, years in business, ownership percentages, stated revenue/income figures, existing debt balances, property addresses, fleet sizes, employee counts
- If a value is stated as approximate (e.g. "about $2 million"), extract it with lower confidence (0.55)
- If a value is stated precisely, use higher confidence (0.75)
- Never infer values not explicitly stated

Return ONLY the JSON object matching this structure:
${structureHint}`;

    const result = await aiJson<{ candidates: TranscriptCandidate[] }>({
      scope: "gap_engine",
      action: "transcript_extraction",
      system: systemPrompt,
      user: `TRANSCRIPT:\n${args.rawText.slice(0, 15000)}`,
      jsonSchemaHint: structureHint,
    });

    const candidates = result.ok ? (result.result?.candidates ?? []) : [];

    return { ok: true, candidates };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
