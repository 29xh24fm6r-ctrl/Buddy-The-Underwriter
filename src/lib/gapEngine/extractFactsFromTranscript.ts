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
 * Uses Gemini Flash to extract both quantitative facts AND qualitative
 * credit narrative facts from meeting transcripts or call notes.
 *
 * SPEC-TRANSCRIPT-EXTRACTION-FULL-1:
 * Expanded beyond dollar amounts to include management background,
 * customer relationships, competitive position, certifications, and
 * other qualitative facts required for the credit memo.
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
      "fact_type": "FINANCIAL | ENTITY | COLLATERAL | LOAN_REQUEST | MANAGEMENT | BUSINESS_CONTEXT | COMPETITIVE | RISK_FACTOR",
      "fact_key": "canonical key — see list below",
      "value": "extracted value — number or string",
      "confidence": 0.0 to 1.0,
      "snippet": "exact quote from transcript supporting this fact",
      "owner_name": "person or entity name if this fact belongs to a specific owner"
    }
  ]
}`;

    const systemPrompt = `You are a fact extraction engine for a commercial bank credit system.

Extract objective, verifiable facts from the following meeting transcript or call notes. Include both quantitative facts AND qualitative credit narrative facts.

FACT TYPES:
- FINANCIAL: dollar amounts, percentages, ratios, revenue figures, debt balances, payment amounts
- ENTITY: business names, entity types, EIN, addresses, formation dates
- COLLATERAL: property addresses, values, equipment descriptions, lien positions
- LOAN_REQUEST: requested amount, term, rate, purpose, use of proceeds
- MANAGEMENT: principal backgrounds, experience, titles, qualifications, track record
- BUSINESS_CONTEXT: business descriptions, operating history, geographic markets, certifications, employee counts
- COMPETITIVE: key customers, market position, competitive advantages, contract details, rankings/awards
- RISK_FACTOR: concentration risks, regulatory concerns, market threats, identified weaknesses

CANONICAL FACT KEYS:

Quantitative:
- TOTAL_REVENUE, NET_INCOME, EBITDA, ANNUAL_DEBT_SERVICE
- EXISTING_DEBT_BALANCE, MONTHLY_PAYMENT, OCCUPANCY_RATE
- YEARS_IN_BUSINESS, EMPLOYEE_COUNT, FLEET_SIZE
- OWNERSHIP_PCT, PROPERTY_VALUE, REQUESTED_LOAN_AMOUNT
- REQUESTED_TERM_MONTHS, REQUESTED_RATE

Qualitative — Management:
- MANAGEMENT_EXPERIENCE_YEARS, MANAGEMENT_BACKGROUND, PRINCIPAL_TITLE
- EDUCATION_CREDENTIAL, INDUSTRY_EXPERTISE, PRIOR_BUSINESS_EXITS

Qualitative — Business Context:
- BUSINESS_DESCRIPTION, GEOGRAPHIC_FOOTPRINT, YEARS_OPERATING
- CERTIFICATION_TYPE, PERFORMANCE_RANKING, AWARD_RECEIVED
- EMPLOYEE_COUNT_BY_CLIENT, TECHNOLOGY_PLATFORM, REGULATORY_STATUS
- GROWTH_CATALYST, USE_OF_PROCEEDS_DETAIL, EXPANSION_PLAN

Qualitative — Competitive Position:
- KEY_CUSTOMER_NAME, KEY_CUSTOMER_REVENUE_PCT, KEY_CUSTOMER_CONTRACT_STATUS
- COMPETITIVE_ADVANTAGE, MARKET_POSITION, BARRIER_TO_ENTRY
- CONTRACT_DURATION_YEARS, PAYMENT_TERMS_CLIENT, RECURRING_REVENUE_PCT

Qualitative — Risk:
- CUSTOMER_CONCENTRATION_PCT, REGULATORY_RISK, KEY_PERSON_DEPENDENCY
- TECHNOLOGY_OBSOLESCENCE_RISK, GEOGRAPHIC_CONCENTRATION

STRICT RULES:
- Extract facts that can be documented in a credit file
- DO NOT extract subjective impressions ("borrower seems trustworthy", "management presents well")
- DO NOT extract predictions or opinions not stated by the borrower
- DO extract stated facts about management experience, customer relationships, competitive position, certifications, geographic markets, contract details, growth plans
- If a value is approximate (e.g. "about $2 million"), extract it with confidence 0.55
- If a value is stated precisely, use confidence 0.75
- For qualitative facts, use the borrower's own stated words as the value
- Never infer values not explicitly stated
- Extract as many facts as the transcript supports — a rich transcript may yield 30+ candidates

Return ONLY the JSON object matching this structure:
${structureHint}`;

    const result = await aiJson<{ candidates: TranscriptCandidate[] }>({
      scope: "gap_engine",
      action: "transcript_extraction",
      system: systemPrompt,
      user: `TRANSCRIPT:\n${args.rawText.slice(0, 30000)}`,
      jsonSchemaHint: structureHint,
    });

    const candidates = result.ok ? (result.result?.candidates ?? []) : [];

    return { ok: true, candidates };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
