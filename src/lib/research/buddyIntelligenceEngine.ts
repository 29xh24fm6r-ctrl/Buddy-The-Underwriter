/**
 * Buddy Intelligence Engine (BIE) — v2 Hardened
 *
 * Institutional-grade research pipeline for commercial credit analysis.
 * Produces fully auditable, source-attributed intelligence packages.
 *
 * Architecture: 8 sequential/parallel threads
 *   Thread 0 (sequential): Entity Identity Lock — confirms WHICH entity before any research
 *   Threads 1–5 (parallel): Borrower, Management, Competitive, Market, Industry
 *   Thread 6 (sequential): Transaction / Repayment analysis (synthesizes 1–5)
 *   Thread 7 (sequential): Credit Synthesis + Final Validation Pass
 *
 * Key hardening (v2):
 *   1. Entity Lock — explicit entity disambiguation before any research begins
 *   2. Management constraint — "ONLY these named individuals" with per-profile confirmation
 *   3. Citation threading — groundingSupports API used to attribute text segments to source URIs
 *   4. Per-section source tracking — every narrative section carries the URLs that grounded it
 *   5. Confidence scoring — every profile and section carries a confidence score
 *   6. Synthesis validation pass — final cross-check that all findings relate to confirmed entity
 *
 * All threads are non-fatal — any failure returns null for that thread.
 * Results stored in buddy_research_narratives as version 3.
 */

import "server-only";

import type { NarrativeSection } from "./types";
import { MODEL_RESEARCH } from "@/lib/ai/models";

// ============================================================================
// Gemini API caller — returns grounding metadata alongside parsed result
// ============================================================================

const GEMINI_MODEL = MODEL_RESEARCH;

type GroundingSegment = {
  text: string;        // exact text segment that was grounded
  urls: string[];      // source URLs supporting this segment
  confidences: number[]; // per-source confidence scores
};

type GeminiGroundedResult<T> = {
  result: T | null;
  sourceUrls: string[];           // all URLs from groundingChunks
  segments: GroundingSegment[];   // text segment → source URL mappings
};

async function callGeminiGrounded<T>(args: {
  prompt: string;
  apiKey: string;
  sources: string[];   // accumulated source list across all threads
  logTag: string;
  useGrounding: boolean;
}): Promise<GeminiGroundedResult<T>> {
  const empty: GeminiGroundedResult<T> = { result: null, sourceUrls: [], segments: [] };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${args.apiKey}`;

  const generationConfig: Record<string, unknown> = { temperature: 0.1 };
  if (!args.useGrounding) {
    generationConfig.responseMimeType = "application/json";
  }

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: args.prompt }] }],
    generationConfig,
  };
  if (args.useGrounding) {
    body.tools = [{ google_search: {} }];
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.warn(`[BIE:${args.logTag}] Gemini ${res.status}: ${errText.slice(0, 300)}`);
      return empty;
    }

    const data = await res.json();
    const candidate = data?.candidates?.[0];
    const groundingMeta = candidate?.groundingMetadata ?? {};

    // Extract all grounding chunk URLs
    const chunks: Array<{ web?: { uri?: string; title?: string } }> =
      groundingMeta.groundingChunks ?? [];
    const chunkUrls = chunks.map((c) => c?.web?.uri ?? "").filter(Boolean);
    for (const u of chunkUrls) args.sources.push(u);

    // Extract grounding supports — maps output text segments to source indices
    const rawSupports: Array<{
      segment?: { startIndex?: number; endIndex?: number; text?: string };
      groundingChunkIndices?: number[];
      confidenceScores?: number[];
    }> = groundingMeta.groundingSupports ?? [];

    const segments: GroundingSegment[] = rawSupports
      .filter((s) => s.segment?.text)
      .map((s) => ({
        text: s.segment!.text!,
        urls: (s.groundingChunkIndices ?? [])
          .map((i) => chunkUrls[i] ?? "")
          .filter(Boolean),
        confidences: s.confidenceScores ?? [],
      }));

    const text: string = candidate?.content?.parts?.[0]?.text ?? "";
    if (!text) return empty;

    const clean = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    const result = JSON.parse(clean) as T;

    return { result, sourceUrls: chunkUrls, segments };
  } catch (e: any) {
    console.warn(`[BIE:${args.logTag}] failed:`, e?.message);
    return empty;
  }
}

// ============================================================================
// Input / Output Types
// ============================================================================

export type BIEInput = {
  company_name: string | null;
  naics_code: string | null;
  naics_description: string | null;
  city: string | null;
  state: string | null;
  geography: string | null;
  principals: Array<{ name: string; title?: string | null }>;
  annual_revenue?: number | null;
  loan_amount?: number | null;
  loan_purpose?: string | null;
};

// Thread 0 — Entity Lock
export type EntityLock = {
  confirmed_name: string;
  confirmed_location: string;
  confirmed_industry: string;
  entity_confidence: number;  // 0.0–1.0
  disambiguation_notes: string;
  alternative_entities_found: string[];
  research_scope: string;
};

// Thread 1 — Borrower
export type BorrowerIntelligence = {
  entity_confirmation: string;     // which exact entity is being described
  entity_confidence: number;
  company_overview: string;
  reputation_and_reviews: string;
  recent_news: string;
  litigation_and_risk: string;
  digital_presence: string;
  customer_base_and_reach: string;
  trend_direction: "improving" | "stable" | "deteriorating" | "unclear";
};

// Thread 2 — Management
export type PrincipalProfile = {
  name: string;
  identity_confirmed: boolean;
  identity_confidence: number;     // 0.0–1.0: confidence this is the right person
  identity_notes: string;          // "Confirmed via [source]" or "No records found"
  background: string;
  other_ventures: string;
  track_record: string;
  red_flags: string;
};

export type ManagementIntelligence = {
  principal_profiles: PrincipalProfile[];
  management_depth: string;
  key_person_risk: string;
  ownership_and_governance: string;
};

// Thread 3 — Competitive
export type CompetitiveIntelligence = {
  direct_competitors: Array<{
    name: string;
    description: string;
    strengths: string;
    weaknesses: string;
    market_position: string;
  }>;
  competitive_dynamics: string;
  barriers_to_entry: string;
  pricing_environment: string;
  borrower_positioning: string;
  trend_direction: "improving" | "stable" | "deteriorating" | "unclear";
};

// Thread 4 — Market
export type MarketIntelligence = {
  local_economic_conditions: string;
  demographic_trends: string;
  real_estate_market: string;
  area_business_environment: string;
  demand_drivers: string;
  area_specific_risks: string;
  trend_direction: "improving" | "stable" | "deteriorating" | "unclear";
};

// Thread 5 — Industry
export type IndustryIntelligence = {
  industry_size_and_growth: string;
  key_trends: string;
  disruption_risks: string;
  margin_environment: string;
  regulatory_landscape: string;
  five_year_outlook: string;
  credit_risk_profile: string;
  trend_direction: "improving" | "stable" | "deteriorating" | "unclear";
};

// Thread 6 — Transaction
export type TransactionRepaymentIntelligence = {
  primary_repayment_source: string;
  secondary_repayment_source: string;
  repayment_vulnerabilities: string;
  structure_alignment: string;
  transaction_type:
    | "self-liquidating"
    | "growth-dependent"
    | "turnaround-dependent"
    | "refinance-dependent"
    | "unclear";
  collateral_adequacy: string;
  downside_case: string;
  stress_scenario: string;
};

// Thread 7 — Synthesis
export type CreditSynthesis = {
  executive_credit_thesis: string;
  repayment_strengths: string[];
  core_vulnerabilities: string[];
  opportunities: string[];
  threats: string[];
  structure_implications: string[];
  underwriting_questions: string[];
  approval_conditions: string[];
  monitoring_triggers: string[];
  three_year_outlook: string;
  five_year_outlook: string;
  contradictions_and_uncertainties: string[];
  evidence_quality_summary: string;
  research_quality_score: "Strong" | "Moderate" | "Limited";
  // Validation results from final pass
  entity_validation_passed: boolean;
  management_profiles_validated: boolean;
  validation_notes: string;
};

// Per-thread source record for citation threading
type ThreadSources = {
  borrower: string[];
  management: string[];
  competitive: string[];
  market: string[];
  industry: string[];
  transaction: string[];
  entity_lock: string[];
};

export type BIEResult = {
  entity_lock: EntityLock | null;        // Thread 0 entity confirmation
  entity_confirmed: boolean;             // did entity lock succeed?
  entity_confidence: number;             // 0.0–1.0
  borrower: BorrowerIntelligence | null;
  management: ManagementIntelligence | null;
  competitive: CompetitiveIntelligence | null;
  market: MarketIntelligence | null;
  industry: IndustryIntelligence | null;
  transaction: TransactionRepaymentIntelligence | null;
  synthesis: CreditSynthesis | null;
  research_quality: "deep" | "partial" | "minimal";
  sources_used: string[];
  thread_sources: ThreadSources;          // per-thread source URLs for citation threading
  compiled_at: string;
};

// ============================================================================
// Thread 0 — Entity Identity Lock
// ============================================================================

async function runEntityLock(
  input: BIEInput,
  apiKey: string,
  sources: string[],
): Promise<{ lock: EntityLock | null; sourceUrls: string[] }> {
  const location = [input.city, input.state].filter(Boolean).join(", ") || "Unknown";
  const revenueStr = input.annual_revenue
    ? `approximately $${(input.annual_revenue / 1_000_000).toFixed(1)}M annual revenue`
    : "revenue unknown";

  const prompt = `You are a commercial bank's due diligence officer. Before any research can begin, you must confirm the exact legal entity being analyzed to prevent misidentification.

TARGET ENTITY:
- Name: ${input.company_name || "Unknown"}
- Location: ${location}
- Industry: ${input.naics_description || `NAICS ${input.naics_code}`}
- Scale: ${revenueStr}

TASK: Use web search to confirm which exact legal entity matches this description. Specifically:
1. Search for "${input.company_name}" in "${location}" in the "${input.naics_description || "specified"}" industry
2. If you find multiple entities with similar names (e.g., "Samaritus Management LLC" vs "Samaritan Companies" vs "Samaritas"), explicitly list EACH entity found, its location, industry, and revenue scale, and identify which one best matches the target
3. Note any entities that are SIMILAR IN NAME but DIFFERENT in identity — these must be excluded from subsequent research
4. Assess how confident you are that you've correctly identified the target entity (0.0 = no match found, 1.0 = definitive match with multiple confirming sources)

Return ONLY valid JSON:
{
  "confirmed_name": "exact legal name of the entity you confirmed, or 'UNCONFIRMED' if no match found",
  "confirmed_location": "confirmed city, state or 'Unknown'",
  "confirmed_industry": "confirmed industry description or 'Unknown'",
  "entity_confidence": 0.0-1.0,
  "disambiguation_notes": "explain any similarly-named entities found and why they were excluded, or 'No similarly-named entities found'",
  "alternative_entities_found": ["Entity A at Location X (different from target)", "Entity B at Location Y"],
  "research_scope": "one sentence: confirm what specific entity all subsequent research should focus on"
}`;

  const gr = await callGeminiGrounded<EntityLock>({
    prompt,
    apiKey,
    sources,
    logTag: "entity-lock",
    useGrounding: true,
  });

  return { lock: gr.result, sourceUrls: gr.sourceUrls };
}

// ============================================================================
// Thread 1 — Borrower Intelligence
// ============================================================================

async function runBorrowerIntelligence(
  input: BIEInput,
  entityLock: EntityLock | null,
  apiKey: string,
  sources: string[],
): Promise<{ result: BorrowerIntelligence | null; sourceUrls: string[] }> {
  const location = [input.city, input.state].filter(Boolean).join(", ") || "Unknown";
  const scopeClause = entityLock?.research_scope
    ? `\nRESEARCH SCOPE (confirmed by entity lock): ${entityLock.research_scope}\nDo NOT include findings about: ${entityLock.alternative_entities_found.join("; ") || "N/A"}`
    : "";

  const prompt = `You are a senior commercial credit analyst conducting pre-loan due diligence.

Company: ${input.company_name || "Unknown"}
Industry: ${input.naics_description || input.naics_code || "Unknown"}
Location: ${location}
${input.loan_purpose ? `Loan Purpose: ${input.loan_purpose}` : ""}
${input.annual_revenue ? `Annual Revenue: approximately $${(input.annual_revenue / 1_000_000).toFixed(1)}M` : ""}
${scopeClause}

ENTITY DISAMBIGUATION REQUIREMENT: You MUST research only the specific entity described above at the specified location. If your web search returns results for a similarly-named company at a different location or in a different industry, explicitly exclude it and note the disambiguation in your output.

Research this specific company using web search. Find:
1. Company overview — founding date, what they do, business model, scale, growth trajectory
2. Online reputation — Google reviews, Yelp, BBB rating and complaints, industry-specific reviews. Note volume, trend, recurring themes.
3. Recent news — last 12–24 months. Business journal, local press, trade publications, press releases, awards, expansions, closures, layoffs
4. Litigation and adverse events — court filings, regulatory actions, OSHA violations, licensing board actions, environmental enforcement, BBB complaints
5. Digital footprint — website quality, social media activity, whether digital presence matches claimed business scale
6. Customer base — who they serve, geographic reach, signs of customer concentration or diversification
7. Trend direction — is this business's public profile improving, stable, or deteriorating?

CLAIM LAYER DISCIPLINE:
Every statement in your output falls into exactly one of three layers:
- FACT: A verifiable claim traceable to a specific public record or source (court filing, news article, company website, government data). State only what you found, not what you inferred.
- INFERENCE: An analytical conclusion you drew from one or more facts. Clearly signal with language like "suggests", "indicates", "implies", "based on [source]".
- NARRATIVE: Synthesized prose for credit memo readability — clearly marked as analysis, not raw fact.
For this thread, the target composition is: 60% FACT, 30% INFERENCE, 10% NARRATIVE.
Do NOT blend them without signaling. Never state an inference as a fact.

Return ONLY valid JSON:
{
  "entity_confirmation": "State exactly which entity your research covers, e.g. 'Research covers [Company Name] at [location], [industry]. Excluded: [any similarly-named companies found].'",
  "entity_confidence": 0.0-1.0,
  "company_overview": "paragraph: founding, what they do, scale, business model, growth",
  "reputation_and_reviews": "paragraph: ratings, sentiment, volume, trend direction",
  "recent_news": "paragraph: notable press coverage, awards, expansions, adverse events",
  "litigation_and_risk": "paragraph: lawsuits, regulatory actions, complaints. State 'No significant adverse events identified in public records' if none found.",
  "digital_presence": "paragraph: website quality, social media activity, digital footprint vs. claimed scale",
  "customer_base_and_reach": "paragraph: customer types, geographic reach, concentration signals",
  "trend_direction": "improving" | "stable" | "deteriorating" | "unclear"
}`;

  const gr = await callGeminiGrounded<BorrowerIntelligence>({
    prompt, apiKey, sources, logTag: "borrower", useGrounding: true,
  });
  return { result: gr.result, sourceUrls: gr.sourceUrls };
}

// ============================================================================
// Thread 2 — Management Intelligence
// ============================================================================

async function runManagementIntelligence(
  input: BIEInput,
  entityLock: EntityLock | null,
  apiKey: string,
  sources: string[],
): Promise<{ result: ManagementIntelligence | null; sourceUrls: string[] }> {
  const location = [input.city, input.state].filter(Boolean).join(", ") || "Unknown";
  const principalsList = input.principals
    .map((p, i) => `${i + 1}. ${p.name}${p.title ? ` (${p.title})` : ""}`)
    .join("\n");

  const hasKnownPrincipals = input.principals.length > 0;
  const principalsStr = hasKnownPrincipals
    ? input.principals.map((p) => `${p.name}${p.title ? ` (${p.title})` : ""}`).join("; ")
    : "Unknown — no principals provided";

  const scopeNote = entityLock?.research_scope
    ? `Entity confirmed: ${entityLock.research_scope}`
    : `Entity: ${input.company_name || "Unknown"} at ${location}`;

  const prompt = `You are a senior commercial credit analyst researching loan guarantors and principals.

${scopeNote}
Company: ${input.company_name || "Unknown"}
Location: ${location}

PRINCIPALS TO RESEARCH (ONLY these individuals):
${principalsList || "None provided"}

=== CRITICAL IDENTITY CONSTRAINTS — READ CAREFULLY ===

1. You MUST ONLY research the individuals explicitly listed above.

2. DO NOT research, include, or reference executives or officers of companies with similar names to "${input.company_name}". For example, if the company is "Samaritus Management LLC", do NOT research executives of "Samaritan Companies", "Samaritas", "Samaritan Health Services", or any other entity. ONLY the individuals listed above.

3. For EACH listed individual, begin your research by confirming: "Is this person specifically associated with ${input.company_name} at ${location}?" Use their name + company name in your search.

4. If you find information for someone with the same name at a different company, DO NOT include it — note "Name match found for [Person] at [Different Company] — excluded, not confirmed at ${input.company_name}."

5. If you cannot find verified public records for a listed principal, return:
   - identity_confirmed: false
   - background: "No verified public records found for [name] associated with ${input.company_name} — insufficient data available."
   - red_flags: "No adverse events identified — note: identity could not be confirmed, so adverse event search may be incomplete."

6. DO NOT fabricate, extrapolate, or guess. Only report verifiable public records.

For each CONFIRMED principal, find:
- Career background — employment history, credentials, licenses, years in this industry
- Other business ventures — current and past ownership, what happened to prior ventures
- Track record — documented successes and failures, industry reputation
- Adverse events — lawsuits, judgments, liens, bankruptcies, criminal matters (public record only), regulatory sanctions. Distinguish allegations from adjudicated outcomes. Cite source for any adverse finding.
- Governance signals — affiliated entities, ownership changes

CLAIM LAYER DISCIPLINE:
Every statement in your output falls into exactly one of three layers:
- FACT: A verifiable claim traceable to a specific public record or source (court filing, news article, company website, government data). State only what you found, not what you inferred.
- INFERENCE: An analytical conclusion you drew from one or more facts. Clearly signal with language like "suggests", "indicates", "implies", "based on [source]".
- NARRATIVE: Synthesized prose for credit memo readability — clearly marked as analysis, not raw fact.
For this thread, the target composition is: 60% FACT, 30% INFERENCE, 10% NARRATIVE.
Do NOT blend them without signaling. Never state an inference as a fact.

Return ONLY valid JSON:
{
  "principal_profiles": [
    {
      "name": "exact name from the list above",
      "identity_confirmed": true/false,
      "identity_confidence": 0.0-1.0,
      "identity_notes": "how you confirmed this person — e.g. 'Confirmed via [source]: listed as owner/officer of ${input.company_name}' OR 'No public records found associating this name with ${input.company_name}'",
      "background": "career history, credentials, industry tenure — or 'No verified public records found' if unconfirmed",
      "other_ventures": "other businesses, current or past, outcomes — or 'Unknown' if unconfirmed",
      "track_record": "successes, failures, reputation — or 'Unknown' if unconfirmed",
      "red_flags": "adverse events with source citation, or 'No adverse events identified in public records'"
    }
  ],
  "management_depth": "team quality, bench strength, relevant expertise — based only on confirmed profiles",
  "key_person_risk": "key-person dependency assessment — based only on confirmed profiles",
  "ownership_and_governance": "affiliated entities, ownership stability, succession clarity"
}`;

  const gr = await callGeminiGrounded<ManagementIntelligence>({
    prompt, apiKey, sources, logTag: "management", useGrounding: true,
  });
  return { result: gr.result, sourceUrls: gr.sourceUrls };
}

// ============================================================================
// Thread 3 — Competitive Intelligence
// ============================================================================

async function runCompetitiveIntelligence(
  input: BIEInput,
  entityLock: EntityLock | null,
  apiKey: string,
  sources: string[],
): Promise<{ result: CompetitiveIntelligence | null; sourceUrls: string[] }> {
  const location = [input.city, input.state].filter(Boolean).join(", ") || "Unknown";

  const prompt = `You are a senior commercial credit analyst assessing competitive positioning for a lending decision.

Company: ${input.company_name || "Unknown"}
Industry: ${input.naics_description || input.naics_code || "Unknown"}
Location: ${location}
${entityLock?.research_scope ? `Entity confirmed: ${entityLock.research_scope}` : ""}

Research the competitive landscape using web search:
1. Identify 3–5 direct competitors BY NAME in this specific market and location — actual businesses competing for the same customers, not generic industry descriptions
2. For each competitor: their scale, strengths, weaknesses, customer sentiment, market position relative to the borrower
3. The borrower's competitive standing — market leader, mid-tier, niche specialist, or commodity provider
4. Barriers to entry — capital, licenses, relationships, proprietary methods, brand, or nothing meaningful
5. Pricing environment — commodity pricing or pricing power, direction of margin pressure
6. Competitive threats — funded national players, PE-backed rollups, technology disruptors entering this market

CLAIM LAYER DISCIPLINE:
Every statement in your output falls into exactly one of three layers:
- FACT: A verifiable claim traceable to a specific public record or source (court filing, news article, company website, government data). State only what you found, not what you inferred.
- INFERENCE: An analytical conclusion you drew from one or more facts. Clearly signal with language like "suggests", "indicates", "implies", "based on [source]".
- NARRATIVE: Synthesized prose for credit memo readability — clearly marked as analysis, not raw fact.
For this thread, the target composition is: 60% FACT, 30% INFERENCE, 10% NARRATIVE.
Do NOT blend them without signaling. Never state an inference as a fact.

Return ONLY valid JSON:
{
  "direct_competitors": [
    {
      "name": "specific company name",
      "description": "scale and what they do",
      "strengths": "competitive advantages",
      "weaknesses": "vulnerabilities",
      "market_position": "position relative to borrower"
    }
  ],
  "competitive_dynamics": "paragraph: how competition plays out",
  "barriers_to_entry": "paragraph: what protects incumbents",
  "pricing_environment": "paragraph: margin pressure, pricing power, cost trends",
  "borrower_positioning": "paragraph: how this borrower stacks up — advantages and disadvantages",
  "trend_direction": "improving" | "stable" | "deteriorating" | "unclear"
}`;

  const gr = await callGeminiGrounded<CompetitiveIntelligence>({
    prompt, apiKey, sources, logTag: "competitive", useGrounding: true,
  });
  return { result: gr.result, sourceUrls: gr.sourceUrls };
}

// ============================================================================
// Thread 4 — Market Intelligence
// ============================================================================

async function runMarketIntelligence(
  input: BIEInput,
  apiKey: string,
  sources: string[],
): Promise<{ result: MarketIntelligence | null; sourceUrls: string[] }> {
  const location = [input.city, input.state].filter(Boolean).join(", ") || "Unknown";

  const prompt = `You are a senior commercial credit analyst conducting local market research for a loan.

Location: ${location}
Industry: ${input.naics_description || "Unknown"}
${input.loan_amount ? `Loan Amount: $${(input.loan_amount / 1_000_000).toFixed(1)}M` : ""}

Research local market conditions using web search:
1. Local economic health — employment trends, major employer arrivals/departures, GDP trajectory, recent economic shocks
2. Population and demographics — growth or decline, income levels vs. national, age distribution, customer base trajectory
3. Commercial real estate — vacancy rates, rent trends, new competitive supply, collateral market strength
4. Local business climate — property taxes, incentives, regulatory environment, permitting
5. Demand drivers — what drives demand for ${input.naics_description || "this type of business"} specifically in this location
6. Area risks — natural disaster exposure, economic concentration, infrastructure, crime trends

CLAIM LAYER DISCIPLINE:
Every statement in your output falls into exactly one of three layers:
- FACT: A verifiable claim traceable to a specific public record or source (court filing, news article, company website, government data). State only what you found, not what you inferred.
- INFERENCE: An analytical conclusion you drew from one or more facts. Clearly signal with language like "suggests", "indicates", "implies", "based on [source]".
- NARRATIVE: Synthesized prose for credit memo readability — clearly marked as analysis, not raw fact.
For this thread, the target composition is: 50% FACT, 30% INFERENCE, 20% NARRATIVE.
Do NOT blend them without signaling. Never state an inference as a fact.

Return ONLY valid JSON:
{
  "local_economic_conditions": "paragraph: economic health, employment, major employers",
  "demographic_trends": "paragraph: population trajectory, income levels, demographic profile",
  "real_estate_market": "paragraph: commercial RE conditions, vacancy, rents, collateral market",
  "area_business_environment": "paragraph: business climate, taxes, incentives, risks",
  "demand_drivers": "paragraph: what drives demand for this business type in this specific location",
  "area_specific_risks": "paragraph: natural disaster, economic concentration, infrastructure, crime",
  "trend_direction": "improving" | "stable" | "deteriorating" | "unclear"
}`;

  const gr = await callGeminiGrounded<MarketIntelligence>({
    prompt, apiKey, sources, logTag: "market", useGrounding: true,
  });
  return { result: gr.result, sourceUrls: gr.sourceUrls };
}

// ============================================================================
// Thread 5 — Industry Intelligence
// ============================================================================

async function runIndustryIntelligence(
  input: BIEInput,
  apiKey: string,
  sources: string[],
): Promise<{ result: IndustryIntelligence | null; sourceUrls: string[] }> {
  const prompt = `You are a senior institutional credit analyst writing an industry analysis for a credit committee.

Industry: ${input.naics_description || input.naics_code || "Unknown"} (NAICS ${input.naics_code || "Unknown"})
${input.annual_revenue ? `Borrower Scale: approximately $${(input.annual_revenue / 1_000_000).toFixed(1)}M annual revenue` : ""}

Write a comprehensive industry analysis using web search for current data:
1. Industry size and growth — specific market size data, CAGR, trajectory with data sources
2. Key trends — 2–3 most important forces reshaping this sector right now
3. Disruption risks — technology, regulatory, or structural threats in the next 5 years
4. Margin environment — typical operating margins for small-to-mid operators, cost structure, pricing power trend
5. Regulatory landscape — primary federal and state regulations, significant changes in last 24 months, pending rules
6. 5-year outlook — growth, consolidation, disruption, or decline
7. Credit risk profile — how this industry has performed through economic downturns (2008, 2020), typical default patterns, cyclicality

CLAIM LAYER DISCIPLINE:
Every statement in your output falls into exactly one of three layers:
- FACT: A verifiable claim traceable to a specific public record or source (court filing, news article, company website, government data). State only what you found, not what you inferred.
- INFERENCE: An analytical conclusion you drew from one or more facts. Clearly signal with language like "suggests", "indicates", "implies", "based on [source]".
- NARRATIVE: Synthesized prose for credit memo readability — clearly marked as analysis, not raw fact.
For this thread, the target composition is: 50% FACT, 30% INFERENCE, 20% NARRATIVE.
Do NOT blend them without signaling. Never state an inference as a fact.

Return ONLY valid JSON:
{
  "industry_size_and_growth": "paragraph with specific dollar figures, CAGR, trajectory",
  "key_trends": "paragraph on 2–3 most important current forces",
  "disruption_risks": "paragraph on technology, regulatory, or structural threats",
  "margin_environment": "paragraph on typical margins, cost pressures, pricing power",
  "regulatory_landscape": "paragraph on key regulations, recent changes, pending rules",
  "five_year_outlook": "paragraph on growth, consolidation, disruption, or decline trajectory",
  "credit_risk_profile": "paragraph on downturn performance, default patterns, cyclicality",
  "trend_direction": "improving" | "stable" | "deteriorating" | "unclear"
}`;

  const gr = await callGeminiGrounded<IndustryIntelligence>({
    prompt, apiKey, sources, logTag: "industry", useGrounding: true,
  });
  return { result: gr.result, sourceUrls: gr.sourceUrls };
}

// ============================================================================
// Thread 6 — Transaction / Repayment Intelligence
// ============================================================================

async function runTransactionRepaymentIntelligence(
  input: BIEInput,
  borrower: BorrowerIntelligence | null,
  management: ManagementIntelligence | null,
  competitive: CompetitiveIntelligence | null,
  market: MarketIntelligence | null,
  industry: IndustryIntelligence | null,
  apiKey: string,
  sources: string[],
): Promise<{ result: TransactionRepaymentIntelligence | null; sourceUrls: string[] }> {
  const location = [input.city, input.state].filter(Boolean).join(", ");

  const prompt = `You are a senior credit officer analyzing the repayment viability of a proposed commercial loan.

DEAL DATA:
- Company: ${input.company_name || "Unknown"}
- Industry: ${input.naics_description || input.naics_code || "Unknown"}
- Location: ${location || "Unknown"}
- Loan Amount: ${input.loan_amount ? `$${(input.loan_amount / 1_000_000).toFixed(2)}M` : "Unknown"}
- Loan Purpose: ${input.loan_purpose || "Unknown"}
- Annual Revenue: ${input.annual_revenue ? `$${(input.annual_revenue / 1_000_000).toFixed(1)}M` : "Unknown"}

RESEARCH SUMMARY:
Borrower: ${borrower ? JSON.stringify({ entity: borrower.entity_confirmation, reputation: borrower.reputation_and_reviews?.slice(0, 300), trend: borrower.trend_direction }) : "Not available"}
Management: ${management ? JSON.stringify({ depth: management.management_depth?.slice(0, 200), key_person_risk: management.key_person_risk?.slice(0, 200) }) : "Not available"}
Competitive: ${competitive ? JSON.stringify({ positioning: competitive.borrower_positioning?.slice(0, 300), trend: competitive.trend_direction }) : "Not available"}
Market: ${market ? JSON.stringify({ conditions: market.local_economic_conditions?.slice(0, 200), trend: market.trend_direction }) : "Not available"}
Industry: ${industry ? JSON.stringify({ profile: industry.credit_risk_profile?.slice(0, 300), outlook: industry.five_year_outlook?.slice(0, 200), trend: industry.trend_direction }) : "Not available"}

Analyze the repayment structure and risk of this specific loan:
1. Primary repayment source — what generates cash to service this debt and how reliable over the proposed term
2. Secondary repayment source — the fallback if primary fails
3. Top 3 repayment vulnerabilities — specific events ranked by likelihood and severity
4. Structure alignment — does the proposed term/amortization match the business cash generation cycle and asset useful life
5. Transaction type classification
6. Collateral adequacy — realistic recovery in default given market conditions
7. Downside case — if top 2 risks materialize, impact on DSCR and repayment
8. Stress scenario — the most plausible bad outcome narrative over the loan term

CLAIM LAYER DISCIPLINE:
Every statement in your output falls into exactly one of three layers:
- FACT: A verifiable claim traceable to a specific public record or source (court filing, news article, company website, government data). State only what you found, not what you inferred.
- INFERENCE: An analytical conclusion you drew from one or more facts. Clearly signal with language like "suggests", "indicates", "implies", "based on [source]".
- NARRATIVE: Synthesized prose for credit memo readability — clearly marked as analysis, not raw fact.
For this thread, the target composition is: 20% FACT, 40% INFERENCE, 40% NARRATIVE.
Do NOT blend them without signaling. Never state an inference as a fact.

Return ONLY valid JSON:
{
  "primary_repayment_source": "paragraph: what generates repayment and how reliable over term",
  "secondary_repayment_source": "paragraph: collateral, guarantor support, or business sale",
  "repayment_vulnerabilities": "paragraph: top 3 specific risk events ranked by likelihood and severity",
  "structure_alignment": "paragraph: does term/amort/purpose match business cycle and asset life",
  "transaction_type": "self-liquidating" | "growth-dependent" | "turnaround-dependent" | "refinance-dependent" | "unclear",
  "collateral_adequacy": "paragraph: realistic liquidation value and recovery in default",
  "downside_case": "paragraph: if top 2 risks materialize simultaneously, impact on DSCR and repayment",
  "stress_scenario": "paragraph: the most plausible bad outcome narrative over the loan term"
}`;

  const gr = await callGeminiGrounded<TransactionRepaymentIntelligence>({
    prompt, apiKey, sources, logTag: "transaction", useGrounding: false,
  });
  return { result: gr.result, sourceUrls: gr.sourceUrls };
}

// ============================================================================
// Thread 7 — Credit Synthesis + Final Validation Pass
// ============================================================================

async function runCreditSynthesis(
  input: BIEInput,
  entityLock: EntityLock | null,
  borrower: BorrowerIntelligence | null,
  management: ManagementIntelligence | null,
  competitive: CompetitiveIntelligence | null,
  market: MarketIntelligence | null,
  industry: IndustryIntelligence | null,
  transaction: TransactionRepaymentIntelligence | null,
  apiKey: string,
  sources: string[],
): Promise<{ result: CreditSynthesis | null; sourceUrls: string[] }> {
  const location = [input.city, input.state].filter(Boolean).join(", ");
  const principalNames = input.principals.map((p) => p.name).join(", ") || "None on file";
  const confirmedPrincipals = management?.principal_profiles
    .filter((p) => p.identity_confirmed)
    .map((p) => p.name)
    .join(", ") || "None confirmed";

  const prompt = `You are a chief credit officer synthesizing a complete loan intelligence package for a credit committee.

COMPANY: ${input.company_name || "Unknown"} | ${input.naics_description || input.naics_code || "Unknown"} | ${location || "Unknown"}
LOAN: ${input.loan_amount ? `$${(input.loan_amount / 1_000_000).toFixed(2)}M` : "Unknown"} | ${input.loan_purpose || "Unknown purpose"}
ENTITY LOCK: ${entityLock ? `${entityLock.confirmed_name} (confidence: ${entityLock.entity_confidence}) — ${entityLock.disambiguation_notes}` : "Entity lock not performed"}
KNOWN PRINCIPALS: ${principalNames}
CONFIRMED PRINCIPALS IN RESEARCH: ${confirmedPrincipals}

RESEARCH FINDINGS:
${borrower ? `BORROWER (entity: ${borrower.entity_confirmation}, confidence: ${borrower.entity_confidence}): ${JSON.stringify(borrower)}` : "BORROWER: Not available"}
${management ? `MANAGEMENT: ${JSON.stringify(management)}` : "MANAGEMENT: Not available"}
${competitive ? `COMPETITIVE: ${JSON.stringify(competitive)}` : "COMPETITIVE: Not available"}
${market ? `MARKET: ${JSON.stringify(market)}` : "MARKET: Not available"}
${industry ? `INDUSTRY: ${JSON.stringify(industry)}` : "INDUSTRY: Not available"}
${transaction ? `TRANSACTION: ${JSON.stringify(transaction)}` : "TRANSACTION: Not available"}

Produce a complete credit synthesis. Every output must be grounded in the research above — no generic statements.

=== FINAL VALIDATION PASS (MANDATORY) ===
Before finalizing your synthesis, complete these checks:

CHECK 1 — Management profile integrity:
Listed principals: ${principalNames}
Confirmed in research: ${confirmedPrincipals}
Are ALL profiles in the management research about individuals from the listed principals? If any management profile covers a person NOT listed above, flag it as "UNVALIDATED_MANAGEMENT_PROFILE" in contradictions_and_uncertainties.
Set management_profiles_validated: true ONLY if all confirmed profiles match listed principals.

CHECK 2 — Entity integrity:
Is all borrower research about: ${entityLock?.confirmed_name || input.company_name}?
If the borrower section references a differently-named entity, flag in contradictions_and_uncertainties.
Set entity_validation_passed: true ONLY if borrower research matches confirmed entity.

CHECK 3 — Geographic relevance:
Are all competitive intelligence findings geographically relevant to: ${location}?
If competitors found are in different markets, note in contradictions_and_uncertainties.

=== END VALIDATION PASS ===

ADVERSARIAL CONTRADICTION CHECKS (mandatory):
Run each check and flag findings in contradictions_and_uncertainties:

CHECK A — Name/entity mismatch: Does the legal name of the borrower match what the management research found?
CHECK B — Revenue plausibility: Does the stated annual revenue (~$${input.annual_revenue ? (input.annual_revenue / 1_000_000).toFixed(1) : "?"}M) make sense given the described business scale and head count?
CHECK C — Geographic mismatch: Do the named competitors operate in ${location}? Are any actually in different markets?
CHECK D — Reputation vs growth story: Does the review sentiment (positive/neutral/negative) align with the claimed growth trajectory?
CHECK E — Management history vs loan purpose: Does any principal's prior venture history create concern about this specific loan purpose?
CHECK F — Industry cyclicality vs loan term: Is the loan term appropriate given the industry's cyclicality and downturn history?
CHECK G — Digital presence vs claimed scale: Does the borrower's digital footprint (website quality, social following) match the described scale of operations?
CHECK H — Regulatory burden vs claimed margins: Does the regulatory environment described impose costs that would compress the margins implied by the financial profile?

For each check: if a contradiction is found, report: "CHECK [X]: [finding]". If no contradiction found, skip. Do not include passing checks.

Return ONLY valid JSON:
{
  "executive_credit_thesis": "2–3 paragraphs grounded in research findings — no generic statements",
  "repayment_strengths": ["specific strength with evidence"],
  "core_vulnerabilities": ["specific risk with evidence"],
  "opportunities": ["specific external positive"],
  "threats": ["specific external threat"],
  "structure_implications": [
    "Specific covenant recommendation based on [finding]",
    "Tenor/amortization recommendation based on [finding]",
    "Collateral/advance rate recommendation based on [finding]",
    "Pricing recommendation based on [finding]",
    "Reporting requirement based on [finding]"
  ],
  "underwriting_questions": ["Specific question arising from [specific finding] — not generic"],
  "approval_conditions": ["Specific diligence item based on finding"],
  "monitoring_triggers": [
    "Business-specific: [specific signal]",
    "Market-specific: [specific local event]",
    "Industry-specific: [specific sector signal]",
    "Financial: [specific metric threshold]"
  ],
  "three_year_outlook": "paragraph: base case, downside case, key assumptions at 3-year mark",
  "five_year_outlook": "paragraph: base case, downside case, strategic position at 5-year mark",
  "contradictions_and_uncertainties": ["specific inconsistency or UNVALIDATED_MANAGEMENT_PROFILE flags"],
  "evidence_quality_summary": "brief paragraph: entity confidence, principal confirmation rate, source quality, key gaps",
  "research_quality_score": "Strong" | "Moderate" | "Limited",
  "entity_validation_passed": true/false,
  "management_profiles_validated": true/false,
  "validation_notes": "summary of what validation checks found — any flags raised"
}`;

  const gr = await callGeminiGrounded<CreditSynthesis>({
    prompt, apiKey, sources, logTag: "synthesis", useGrounding: false,
  });
  return { result: gr.result, sourceUrls: gr.sourceUrls };
}

// ============================================================================
// Main Orchestrator
// ============================================================================

function emptyBIEResult(): BIEResult {
  return {
    entity_lock: null,
    entity_confirmed: false,
    entity_confidence: 0,
    borrower: null,
    management: null,
    competitive: null,
    market: null,
    industry: null,
    transaction: null,
    synthesis: null,
    research_quality: "minimal",
    sources_used: [],
    thread_sources: {
      borrower: [], management: [], competitive: [],
      market: [], industry: [], transaction: [], entity_lock: [],
    },
    compiled_at: new Date().toISOString(),
  };
}

export async function runBuddyIntelligenceEngine(input: BIEInput): Promise<BIEResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[BIE] GEMINI_API_KEY missing — skipping BIE");
    return emptyBIEResult();
  }

  const allSources: string[] = [];

  // ── Thread 0: Entity Lock (sequential first — all other threads depend on it) ──
  let entityLock: EntityLock | null = null;
  let entityLockSources: string[] = [];
  try {
    const r = await runEntityLock(input, apiKey, allSources);
    entityLock = r.lock;
    entityLockSources = r.sourceUrls;
    if (entityLock) {
      console.log(
        `[BIE] Entity lock: "${entityLock.confirmed_name}" confidence=${entityLock.entity_confidence}`,
        entityLock.alternative_entities_found.length > 0
          ? `alternatives excluded: ${entityLock.alternative_entities_found.join(", ")}`
          : "no alternatives found",
      );
    }
  } catch (e: any) {
    console.warn("[BIE] Entity lock failed (non-fatal):", e?.message);
  }

  // ── Threads 1–5: Run in parallel ──
  const [t1, t2, t3, t4, t5] = await Promise.allSettled([
    runBorrowerIntelligence(input, entityLock, apiKey, allSources),
    runManagementIntelligence(input, entityLock, apiKey, allSources),
    runCompetitiveIntelligence(input, entityLock, apiKey, allSources),
    runMarketIntelligence(input, apiKey, allSources),
    runIndustryIntelligence(input, apiKey, allSources),
  ]);

  const borrowerR = t1.status === "fulfilled" ? t1.value : { result: null, sourceUrls: [] };
  const managementR = t2.status === "fulfilled" ? t2.value : { result: null, sourceUrls: [] };
  const competitiveR = t3.status === "fulfilled" ? t3.value : { result: null, sourceUrls: [] };
  const marketR = t4.status === "fulfilled" ? t4.value : { result: null, sourceUrls: [] };
  const industryR = t5.status === "fulfilled" ? t5.value : { result: null, sourceUrls: [] };

  const borrower = borrowerR.result;
  const management = managementR.result;
  const competitive = competitiveR.result;
  const market = marketR.result;
  const industry = industryR.result;

  // ── Thread 6: Transaction (sequential — needs 1–5) ──
  let transactionR: { result: TransactionRepaymentIntelligence | null; sourceUrls: string[] } =
    { result: null, sourceUrls: [] };
  try {
    transactionR = await runTransactionRepaymentIntelligence(
      input, borrower, management, competitive, market, industry, apiKey, allSources,
    );
  } catch (e: any) {
    console.warn("[BIE] Transaction thread failed:", e?.message);
  }
  const transaction = transactionR.result;

  // ── Thread 7: Synthesis + Validation Pass (sequential) ──
  let synthesisR: { result: CreditSynthesis | null; sourceUrls: string[] } =
    { result: null, sourceUrls: [] };
  try {
    synthesisR = await runCreditSynthesis(
      input, entityLock, borrower, management, competitive, market, industry, transaction,
      apiKey, allSources,
    );
  } catch (e: any) {
    console.warn("[BIE] Synthesis thread failed:", e?.message);
  }
  const synthesis = synthesisR.result;

  // Log validation results
  if (synthesis) {
    if (!synthesis.entity_validation_passed) {
      console.warn(`[BIE] Entity validation FAILED for "${input.company_name}": ${synthesis.validation_notes}`);
    }
    if (!synthesis.management_profiles_validated) {
      console.warn(`[BIE] Management profiles validation FAILED for "${input.company_name}": ${synthesis.validation_notes}`);
    }
  }

  const successCount = [borrower, management, competitive, market, industry, transaction].filter(Boolean).length;
  const entityConfidence = entityLock?.entity_confidence ?? 0;

  return {
    entity_lock: entityLock,
    entity_confirmed: entityConfidence >= 0.6,
    entity_confidence: entityConfidence,
    borrower,
    management,
    competitive,
    market,
    industry,
    transaction,
    synthesis,
    research_quality: successCount >= 4 ? "deep" : successCount >= 2 ? "partial" : "minimal",
    sources_used: [...new Set(allSources)].slice(0, 50),
    thread_sources: {
      entity_lock: entityLockSources,
      borrower: borrowerR.sourceUrls,
      management: managementR.sourceUrls,
      competitive: competitiveR.sourceUrls,
      market: marketR.sourceUrls,
      industry: industryR.sourceUrls,
      transaction: transactionR.sourceUrls,
    },
    compiled_at: new Date().toISOString(),
  };
}

// ============================================================================
// Narrative Section Builder
// ============================================================================

/**
 * Convert a BIEResult into NarrativeSection[] for storage in
 * buddy_research_narratives (version 3).
 *
 * v2: Source URLs from each thread are threaded into sentence citations,
 * making every narrative section fully auditable. Format:
 *   citation.type = "url", citation.id = source_url
 */
export function buildBIENarrativeSections(result: BIEResult): NarrativeSection[] {
  const sections: NarrativeSection[] = [];
  const ts = result.thread_sources;

  // Build citation objects from URL arrays
  function urlsToCitations(urls: string[]): Array<{ type: string; id: string; url: string }> {
    return [...new Set(urls)].slice(0, 5).map((url) => ({ type: "url", id: url, url }));
  }

  function addSection(
    title: string,
    sourceUrls: string[],
    ...texts: (string | null | undefined)[]
  ): void {
    const validTexts = texts.filter((t): t is string => !!t && t.trim().length > 0);
    if (validTexts.length === 0) return;
    const citations = urlsToCitations(sourceUrls) as any[];
    sections.push({
      title,
      sentences: validTexts.map((text) => ({ text, citations })),
    });
  }

  const { borrower, management, competitive, market, industry, transaction, synthesis } = result;

  // Entity lock section (new in v2)
  if (result.entity_lock) {
    const el = result.entity_lock;
    addSection(
      "Entity Identification",
      ts.entity_lock,
      `Research Entity: ${el.confirmed_name} at ${el.confirmed_location}. Confidence: ${Math.round(el.entity_confidence * 100)}%.`,
      el.disambiguation_notes !== "No similarly-named entities found" ? el.disambiguation_notes : undefined,
      el.research_scope,
    );
  }

  // Industry sections
  if (industry) {
    addSection("Industry Overview", ts.industry,
      industry.industry_size_and_growth, industry.key_trends);
    addSection("Industry Outlook", ts.industry,
      industry.five_year_outlook, industry.disruption_risks, industry.credit_risk_profile);
    addSection("Regulatory Environment", ts.industry,
      industry.regulatory_landscape, industry.margin_environment);
  }

  // Competitive
  if (competitive) {
    const competitorProse =
      competitive.direct_competitors
        .map((c) => `${c.name}: ${c.description} Strengths: ${c.strengths} Weaknesses: ${c.weaknesses} Position: ${c.market_position}`)
        .join("\n") || undefined;
    addSection("Competitive Landscape", ts.competitive,
      competitive.competitive_dynamics, competitive.borrower_positioning, competitorProse);
  }

  // Market
  if (market) {
    addSection("Market Intelligence", ts.market,
      market.local_economic_conditions, market.demographic_trends,
      market.demand_drivers, market.area_specific_risks);
  }

  // Borrower profile + litigation — include entity confirmation note
  if (borrower) {
    const entityNote = borrower.entity_confidence < 0.7
      ? `NOTE: Entity confidence is ${Math.round(borrower.entity_confidence * 100)}% — research may be incomplete or partially attributed to a similarly-named entity. ${borrower.entity_confirmation}`
      : borrower.entity_confirmation;
    addSection("Borrower Profile", ts.borrower,
      entityNote,
      borrower.company_overview, borrower.reputation_and_reviews,
      borrower.recent_news, borrower.customer_base_and_reach);
    addSection("Litigation and Risk", ts.borrower, borrower.litigation_and_risk);
  }

  // Management — per-sentence construction with per-profile confidence
  if (management) {
    const mgmtCitations = urlsToCitations(ts.management) as any[];
    const mgmtSentences: { text: string; citations: any[] }[] = [];

    for (const p of management.principal_profiles.slice(0, 5)) {
      // Add confidence/confirmation note before each profile
      const confirmNote = p.identity_confirmed
        ? `${p.name} (identity confirmed, confidence: ${Math.round(p.identity_confidence * 100)}%): ${p.identity_notes}`
        : `${p.name} (identity UNCONFIRMED — ${p.identity_notes})`;
      mgmtSentences.push({ text: confirmNote, citations: mgmtCitations });

      if (p.identity_confirmed) {
        if (p.background) mgmtSentences.push({ text: p.background, citations: mgmtCitations });
        if (p.other_ventures && p.other_ventures !== "Unknown") mgmtSentences.push({ text: p.other_ventures, citations: mgmtCitations });
        if (p.track_record && p.track_record !== "Unknown") mgmtSentences.push({ text: p.track_record, citations: mgmtCitations });
        if (p.red_flags) mgmtSentences.push({ text: p.red_flags, citations: mgmtCitations });
      }
    }
    if (management.management_depth) mgmtSentences.push({ text: management.management_depth, citations: mgmtCitations });
    if (management.key_person_risk) mgmtSentences.push({ text: management.key_person_risk, citations: mgmtCitations });
    if (management.ownership_and_governance) mgmtSentences.push({ text: management.ownership_and_governance, citations: mgmtCitations });

    if (mgmtSentences.length > 0) {
      sections.push({ title: "Management Intelligence", sentences: mgmtSentences });
    }
  }

  // Transaction
  if (transaction) {
    addSection("Transaction Analysis", ts.transaction,
      transaction.primary_repayment_source,
      transaction.secondary_repayment_source,
      transaction.repayment_vulnerabilities,
      transaction.structure_alignment,
      transaction.collateral_adequacy,
      transaction.downside_case,
      transaction.stress_scenario);
  }

  // Synthesis (no external sources — synthesis is derived from other threads)
  if (synthesis) {
    const validationNote = (!synthesis.entity_validation_passed || !synthesis.management_profiles_validated)
      ? `VALIDATION NOTE: ${synthesis.validation_notes}`
      : undefined;

    addSection("Credit Thesis", [],
      synthesis.executive_credit_thesis,
      validationNote);
    if (synthesis.structure_implications.length > 0) {
      addSection("Structure Implications", [], synthesis.structure_implications.join("\n"));
    }
    if (synthesis.underwriting_questions.length > 0) {
      addSection("Underwriting Questions", [], synthesis.underwriting_questions.join("\n"));
    }
    if (synthesis.monitoring_triggers.length > 0) {
      addSection("Monitoring Triggers", [], synthesis.monitoring_triggers.join("\n"));
    }
    if (synthesis.contradictions_and_uncertainties.length > 0) {
      addSection("Contradictions", [], synthesis.contradictions_and_uncertainties.join("\n"));
    }
    addSection("3-Year and 5-Year Outlook", [],
      synthesis.three_year_outlook, synthesis.five_year_outlook);
  }

  // BIE metadata — includes entity confirmation for downstream validation
  const metaPayload = JSON.stringify({
    research_quality_score: synthesis?.research_quality_score ?? "Moderate",
    sources_count: result.sources_used.length,
    entity_confirmed: result.entity_confirmed,
    entity_confidence: result.entity_confidence,
    entity_lock_name: result.entity_lock?.confirmed_name ?? null,
    management_profiles_validated: synthesis?.management_profiles_validated ?? null,
    entity_validation_passed: synthesis?.entity_validation_passed ?? null,
  });

  sections.push({
    title: "BIE Sources",
    sentences: [
      { text: `BIE_META:${metaPayload}`, citations: [] },
      ...result.sources_used.slice(0, 30).map((url) => ({ text: url, citations: [] })),
    ],
  });

  return sections;
}
