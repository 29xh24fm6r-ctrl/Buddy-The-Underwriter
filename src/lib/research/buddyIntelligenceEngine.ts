/**
 * Buddy Intelligence Engine (BIE)
 *
 * Runs 6 parallel Gemini research threads (with Google Search grounding)
 * + 1 sequential synthesis thread (no grounding) to produce an
 * institutional-grade credit intelligence package.
 *
 * Results are persisted to buddy_research_narratives as version 3,
 * overwriting the BRE's version 1 output for the same mission.
 *
 * All threads are non-fatal — any failure returns null for that thread.
 */

import "server-only";

import type { NarrativeSection } from "./types";

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

export type BorrowerIntelligence = {
  company_overview: string;
  reputation_and_reviews: string;
  recent_news: string;
  litigation_and_risk: string;
  digital_presence: string;
  customer_base_and_reach: string;
  trend_direction: "improving" | "stable" | "deteriorating" | "unclear";
};

export type ManagementIntelligence = {
  principal_profiles: Array<{
    name: string;
    background: string;
    other_ventures: string;
    track_record: string;
    red_flags: string;
  }>;
  management_depth: string;
  key_person_risk: string;
  ownership_and_governance: string;
};

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

export type MarketIntelligence = {
  local_economic_conditions: string;
  demographic_trends: string;
  real_estate_market: string;
  area_business_environment: string;
  demand_drivers: string;
  area_specific_risks: string;
  trend_direction: "improving" | "stable" | "deteriorating" | "unclear";
};

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
};

export type BIEResult = {
  borrower: BorrowerIntelligence | null;
  management: ManagementIntelligence | null;
  competitive: CompetitiveIntelligence | null;
  market: MarketIntelligence | null;
  industry: IndustryIntelligence | null;
  transaction: TransactionRepaymentIntelligence | null;
  synthesis: CreditSynthesis | null;
  research_quality: "deep" | "partial" | "minimal";
  sources_used: string[];
  compiled_at: string;
};

// ============================================================================
// Core Gemini Caller
// ============================================================================

const GEMINI_MODEL = "gemini-3.1-pro-preview";

async function callGeminiGrounded<T>(args: {
  prompt: string;
  apiKey: string;
  sources: string[];
  logTag: string;
  useGrounding: boolean;
}): Promise<T | null> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${args.apiKey}`;

  const generationConfig: Record<string, unknown> = {
    temperature: 0.2,
  };

  // responseMimeType is incompatible with google_search grounding
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
      return null;
    }

    const data = await res.json();

    // Collect grounding sources
    const chunks = data?.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    for (const chunk of chunks) {
      if (chunk?.web?.uri) args.sources.push(chunk.web.uri);
    }

    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) return null;

    // Strip markdown code fences and parse
    const clean = text.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
    return JSON.parse(clean) as T;
  } catch (e: any) {
    console.warn(`[BIE:${args.logTag}] failed:`, e?.message);
    return null;
  }
}

// ============================================================================
// Thread 1 — Borrower Intelligence
// ============================================================================

async function runBorrowerIntelligence(
  input: BIEInput,
  apiKey: string,
  sources: string[],
): Promise<BorrowerIntelligence | null> {
  const location = [input.city, input.state].filter(Boolean).join(", ") || "Unknown";
  const prompt = `You are a senior commercial credit analyst conducting pre-loan due diligence.

Company: ${input.company_name || "Unknown"}
Industry: ${input.naics_description || input.naics_code || "Unknown"}
Location: ${location}
${input.loan_purpose ? `Loan Purpose: ${input.loan_purpose}` : ""}
${input.annual_revenue ? `Annual Revenue: approximately $${(input.annual_revenue / 1_000_000).toFixed(1)}M` : ""}

Research this specific company using web search. Find:
1. Company overview — founding date, what they do, business model, scale, growth trajectory
2. Online reputation — Google reviews, Yelp, BBB rating and complaints, industry-specific reviews. Note volume, trend, recurring themes.
3. Recent news — last 12–24 months. Business journal, local press, trade publications, press releases, awards, expansions, closures, layoffs
4. Litigation and adverse events — court filings, regulatory actions, OSHA violations, licensing board actions, environmental enforcement, BBB complaints
5. Digital footprint — website quality, social media activity and engagement, whether digital presence matches claimed business scale
6. Customer base — who they serve, geographic reach, signs of customer concentration or diversification
7. Trend direction — is this business's public profile improving, stable, or deteriorating?

Return ONLY valid JSON with this exact structure:
{
  "company_overview": "paragraph: founding, what they do, scale, business model, growth",
  "reputation_and_reviews": "paragraph: ratings, sentiment, volume, trend direction",
  "recent_news": "paragraph: notable press coverage, awards, expansions, adverse events",
  "litigation_and_risk": "paragraph: lawsuits, regulatory actions, complaints. State 'No significant adverse events identified in public records' if none found.",
  "digital_presence": "paragraph: website quality, social media activity, digital footprint consistency with claimed scale",
  "customer_base_and_reach": "paragraph: customer types, geographic reach, concentration signals",
  "trend_direction": "improving" | "stable" | "deteriorating" | "unclear"
}`;

  return callGeminiGrounded<BorrowerIntelligence>({
    prompt,
    apiKey,
    sources,
    logTag: "borrower",
    useGrounding: true,
  });
}

// ============================================================================
// Thread 2 — Management Intelligence
// ============================================================================

async function runManagementIntelligence(
  input: BIEInput,
  apiKey: string,
  sources: string[],
): Promise<ManagementIntelligence | null> {
  const location = [input.city, input.state].filter(Boolean).join(", ") || "Unknown";
  const principalsStr =
    input.principals.map((p) => `${p.name}${p.title ? ` (${p.title})` : ""}`).join("; ") ||
    "Unknown";

  const prompt = `You are a senior commercial credit analyst researching loan guarantors and principals.

Company: ${input.company_name || "Unknown"}
Location: ${location}
Principals: ${principalsStr}

Research each principal using web search. For each person find:
1. Career background — employment history, credentials, licenses, years in this industry
2. Other business ventures — current and past ownership, what happened to prior ventures
3. Track record — documented successes and failures, industry reputation
4. Adverse events — lawsuits, judgments, liens, bankruptcies, criminal matters of public record, regulatory sanctions. IMPORTANT: only cite findings you can trace to a court record, regulatory filing, or credible news source. Do not include forum content, rumors, or unverified allegations. Distinguish allegations from adjudicated outcomes.
5. Community and industry standing — associations, boards, civic roles, recognitions
6. Governance signals — affiliated entities, ownership changes, succession indicators

Return ONLY valid JSON:
{
  "principal_profiles": [
    {
      "name": "string",
      "background": "career history, credentials, industry tenure",
      "other_ventures": "other businesses, current or past, outcomes",
      "track_record": "successes, failures, reputation",
      "red_flags": "adverse events with source citations. State 'No adverse events identified in public records' if none found."
    }
  ],
  "management_depth": "assessment of team quality, bench strength, relevant expertise",
  "key_person_risk": "assessment of key-person dependency — what happens if the principal is unavailable",
  "ownership_and_governance": "affiliated entities, ownership stability, succession clarity"
}`;

  return callGeminiGrounded<ManagementIntelligence>({
    prompt,
    apiKey,
    sources,
    logTag: "management",
    useGrounding: true,
  });
}

// ============================================================================
// Thread 3 — Competitive Intelligence
// ============================================================================

async function runCompetitiveIntelligence(
  input: BIEInput,
  apiKey: string,
  sources: string[],
): Promise<CompetitiveIntelligence | null> {
  const location = [input.city, input.state].filter(Boolean).join(", ") || "Unknown";

  const prompt = `You are a senior commercial credit analyst assessing competitive positioning for a lending decision.

Company: ${input.company_name || "Unknown"}
Industry: ${input.naics_description || input.naics_code || "Unknown"}
Location: ${location}

Research the competitive landscape using web search:
1. Identify 3–5 direct competitors BY NAME in this specific market — not generic industry players but actual businesses competing for the same customers
2. For each competitor: their scale, strengths, weaknesses, customer sentiment, positioning vs. the borrower
3. The borrower's competitive standing — market leader, mid-tier, niche specialist, or commodity provider
4. Barriers to entry — capital, licenses, relationships, proprietary methods, brand, or nothing meaningful
5. Pricing environment — commodity pricing or pricing power, direction of margin pressure
6. Competitive threats — funded national players, PE-backed rollups, technology disruptors entering this market

Return ONLY valid JSON:
{
  "direct_competitors": [
    {
      "name": "string",
      "description": "scale and what they do",
      "strengths": "their competitive advantages",
      "weaknesses": "their vulnerabilities",
      "market_position": "how they sit relative to the borrower"
    }
  ],
  "competitive_dynamics": "paragraph: how competition plays out — price-driven, relationship-driven, quality-driven",
  "barriers_to_entry": "paragraph: what protects incumbents",
  "pricing_environment": "paragraph: margin pressure, pricing power, cost trends",
  "borrower_positioning": "paragraph: specifically how this borrower stacks up — advantages and disadvantages",
  "trend_direction": "improving" | "stable" | "deteriorating" | "unclear"
}`;

  return callGeminiGrounded<CompetitiveIntelligence>({
    prompt,
    apiKey,
    sources,
    logTag: "competitive",
    useGrounding: true,
  });
}

// ============================================================================
// Thread 4 — Market Intelligence
// ============================================================================

async function runMarketIntelligence(
  input: BIEInput,
  apiKey: string,
  sources: string[],
): Promise<MarketIntelligence | null> {
  const location = [input.city, input.state].filter(Boolean).join(", ") || "Unknown";

  const prompt = `You are a senior commercial credit analyst conducting local market research for a loan.

Location: ${location}
Industry: ${input.naics_description || "Unknown"}
${input.loan_amount ? `Loan Amount: $${(input.loan_amount / 1_000_000).toFixed(1)}M` : ""}

Research local market conditions using web search:
1. Local economic health — employment trends, major employer arrivals/departures, GDP trajectory, recent economic shocks
2. Population and demographics — growth or decline, income levels vs. national, age distribution, customer base trajectory
3. Commercial real estate — vacancy rates, rent trends, new competitive supply, market strength for collateral
4. Local business climate — property taxes, incentives, regulatory environment, permitting
5. Demand drivers — what drives demand for ${input.naics_description || "this type of business"} specifically in this location
6. Area risks — natural disaster exposure, economic concentration, infrastructure, crime trends

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

  return callGeminiGrounded<MarketIntelligence>({
    prompt,
    apiKey,
    sources,
    logTag: "market",
    useGrounding: true,
  });
}

// ============================================================================
// Thread 5 — Industry Intelligence
// ============================================================================

async function runIndustryIntelligence(
  input: BIEInput,
  apiKey: string,
  sources: string[],
): Promise<IndustryIntelligence | null> {
  const prompt = `You are a senior institutional credit analyst writing an industry analysis for a credit committee.

Industry: ${input.naics_description || input.naics_code || "Unknown"} (NAICS ${input.naics_code || "Unknown"})
${input.annual_revenue ? `Borrower Scale: approximately $${(input.annual_revenue / 1_000_000).toFixed(1)}M annual revenue` : ""}

Write a comprehensive industry analysis using web search for current data:
1. Industry size and growth — specific market size data, CAGR, trajectory with data sources
2. Key trends — 2–3 most important forces reshaping this sector right now
3. Disruption risks — technology, regulatory, or structural threats that could impair industry economics in the next 5 years
4. Margin environment — typical operating margins for small-to-mid operators, cost structure, pricing power trend
5. Regulatory landscape — primary federal and state regulations, significant changes in last 24 months, pending rules
6. 5-year outlook — where will this industry be in 5 years; growth, consolidation, disruption, or decline
7. Credit risk profile — how this industry has performed through economic downturns (2008, 2020), typical default patterns, cyclicality

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

  return callGeminiGrounded<IndustryIntelligence>({
    prompt,
    apiKey,
    sources,
    logTag: "industry",
    useGrounding: true,
  });
}

// ============================================================================
// Thread 6 — Transaction / Repayment Intelligence (no grounding)
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
): Promise<TransactionRepaymentIntelligence | null> {
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
Borrower: ${borrower ? JSON.stringify({ reputation: borrower.reputation_and_reviews?.slice(0, 300), trend: borrower.trend_direction }) : "Not available"}
Management: ${management ? JSON.stringify({ depth: management.management_depth?.slice(0, 200), key_person_risk: management.key_person_risk?.slice(0, 200) }) : "Not available"}
Competitive: ${competitive ? JSON.stringify({ positioning: competitive.borrower_positioning?.slice(0, 300), trend: competitive.trend_direction }) : "Not available"}
Market: ${market ? JSON.stringify({ conditions: market.local_economic_conditions?.slice(0, 200), trend: market.trend_direction }) : "Not available"}
Industry: ${industry ? JSON.stringify({ profile: industry.credit_risk_profile?.slice(0, 300), outlook: industry.five_year_outlook?.slice(0, 200), trend: industry.trend_direction }) : "Not available"}

Analyze the repayment structure and risk of this specific loan:
1. Primary repayment source — what generates cash to service this debt and how reliable is it over the proposed term
2. Secondary repayment source — the fallback if primary fails
3. Top 3 repayment vulnerabilities — specific events or conditions that would impair debt service, ranked by likelihood
4. Structure alignment — does the proposed term/amortization match the business cash generation cycle and asset useful life
5. Transaction type classification
6. Collateral adequacy — realistic recovery in default scenario given market conditions found
7. Downside case — if top 2 risks materialize, what happens to the borrower's ability to service debt
8. Stress scenario — the most plausible bad outcome narrative for this specific borrower over the loan term

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

  return callGeminiGrounded<TransactionRepaymentIntelligence>({
    prompt,
    apiKey,
    sources,
    logTag: "transaction",
    useGrounding: false,
  });
}

// ============================================================================
// Thread 7 — Credit Synthesis (no grounding)
// ============================================================================

async function runCreditSynthesis(
  input: BIEInput,
  borrower: BorrowerIntelligence | null,
  management: ManagementIntelligence | null,
  competitive: CompetitiveIntelligence | null,
  market: MarketIntelligence | null,
  industry: IndustryIntelligence | null,
  transaction: TransactionRepaymentIntelligence | null,
  apiKey: string,
  sources: string[],
): Promise<CreditSynthesis | null> {
  const location = [input.city, input.state].filter(Boolean).join(", ");

  const prompt = `You are a chief credit officer synthesizing a complete loan intelligence package for a credit committee.

COMPANY: ${input.company_name || "Unknown"} | ${input.naics_description || input.naics_code || "Unknown"} | ${location || "Unknown"}
LOAN: ${input.loan_amount ? `$${(input.loan_amount / 1_000_000).toFixed(2)}M` : "Unknown"} | ${input.loan_purpose || "Unknown purpose"}

RESEARCH FINDINGS:
${borrower ? `BORROWER: ${JSON.stringify(borrower)}` : "BORROWER: Not available"}
${management ? `MANAGEMENT: ${JSON.stringify(management)}` : "MANAGEMENT: Not available"}
${competitive ? `COMPETITIVE: ${JSON.stringify(competitive)}` : "COMPETITIVE: Not available"}
${market ? `MARKET: ${JSON.stringify(market)}` : "MARKET: Not available"}
${industry ? `INDUSTRY: ${JSON.stringify(industry)}` : "INDUSTRY: Not available"}
${transaction ? `TRANSACTION: ${JSON.stringify(transaction)}` : "TRANSACTION: Not available"}

Produce a complete credit synthesis. Every output must be grounded in the research above — no generic statements.

Return ONLY valid JSON:
{
  "executive_credit_thesis": "2–3 paragraphs: who this borrower is, what makes this credit work or not work, primary risks, overall stance. Every sentence must reference specific research findings.",
  "repayment_strengths": ["specific internal factor 1", "specific internal factor 2"],
  "core_vulnerabilities": ["specific risk 1 with evidence", "specific risk 2 with evidence"],
  "opportunities": ["specific external positive 1"],
  "threats": ["specific external threat 1"],
  "structure_implications": [
    "Specific covenant recommendation based on [finding]",
    "Tenor/amortization recommendation based on [finding]",
    "Collateral/advance rate recommendation based on [finding]",
    "Pricing recommendation based on [finding]",
    "Reporting requirement based on [finding]"
  ],
  "underwriting_questions": [
    "Specific question arising from [specific finding] — not generic"
  ],
  "approval_conditions": ["Specific diligence item 1"],
  "monitoring_triggers": [
    "Business-specific: [specific signal to watch]",
    "Market-specific: [specific local event]",
    "Industry-specific: [specific sector signal]",
    "Financial: [specific metric threshold]"
  ],
  "three_year_outlook": "paragraph: base case, downside case, key assumptions at the 3-year mark",
  "five_year_outlook": "paragraph: base case, downside case, strategic position at the 5-year mark",
  "contradictions_and_uncertainties": [
    "Specific inconsistency found: [what doesn't line up]"
  ],
  "evidence_quality_summary": "Brief paragraph: entity identification confidence, source quality breakdown, key gaps",
  "research_quality_score": "Strong" | "Moderate" | "Limited"
}`;

  return callGeminiGrounded<CreditSynthesis>({
    prompt,
    apiKey,
    sources,
    logTag: "synthesis",
    useGrounding: false,
  });
}

// ============================================================================
// Main Orchestrator
// ============================================================================

function emptyBIEResult(): BIEResult {
  return {
    borrower: null,
    management: null,
    competitive: null,
    market: null,
    industry: null,
    transaction: null,
    synthesis: null,
    research_quality: "minimal",
    sources_used: [],
    compiled_at: new Date().toISOString(),
  };
}

export async function runBuddyIntelligenceEngine(input: BIEInput): Promise<BIEResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[BIE] GEMINI_API_KEY missing — skipping BIE");
    return emptyBIEResult();
  }

  const sources: string[] = [];

  // Threads 1–5 run in parallel
  const [t1, t2, t3, t4, t5] = await Promise.allSettled([
    runBorrowerIntelligence(input, apiKey, sources),
    runManagementIntelligence(input, apiKey, sources),
    runCompetitiveIntelligence(input, apiKey, sources),
    runMarketIntelligence(input, apiKey, sources),
    runIndustryIntelligence(input, apiKey, sources),
  ]);

  const borrower = t1.status === "fulfilled" ? t1.value : null;
  const management = t2.status === "fulfilled" ? t2.value : null;
  const competitive = t3.status === "fulfilled" ? t3.value : null;
  const market = t4.status === "fulfilled" ? t4.value : null;
  const industry = t5.status === "fulfilled" ? t5.value : null;

  // Thread 6: Transaction — sequential after 1–5 (needs their output)
  let transaction: TransactionRepaymentIntelligence | null = null;
  try {
    transaction = await runTransactionRepaymentIntelligence(
      input,
      borrower,
      management,
      competitive,
      market,
      industry,
      apiKey,
      sources,
    );
  } catch (e: any) {
    console.warn("[BIE] Transaction thread failed:", e?.message);
  }

  // Thread 7: Synthesis — sequential, no grounding
  let synthesis: CreditSynthesis | null = null;
  try {
    synthesis = await runCreditSynthesis(
      input,
      borrower,
      management,
      competitive,
      market,
      industry,
      transaction,
      apiKey,
      sources,
    );
  } catch (e: any) {
    console.warn("[BIE] Synthesis thread failed:", e?.message);
  }

  const successCount = [borrower, management, competitive, market, industry, transaction].filter(
    Boolean,
  ).length;

  return {
    borrower,
    management,
    competitive,
    market,
    industry,
    transaction,
    synthesis,
    research_quality: successCount >= 4 ? "deep" : successCount >= 2 ? "partial" : "minimal",
    sources_used: [...new Set(sources)].slice(0, 30),
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
 * Section titles are chosen to match the SECTION_MAP in loadResearchForMemo.ts
 * so that sectionsToText() can find them after BIE sections are merged into the
 * CreditCommitteePack.
 */
export function buildBIENarrativeSections(result: BIEResult): NarrativeSection[] {
  const sections: NarrativeSection[] = [];

  function addSection(title: string, ...texts: (string | null | undefined)[]): void {
    const validTexts = texts.filter((t): t is string => !!t && t.trim().length > 0);
    if (validTexts.length === 0) return;
    sections.push({
      title,
      sentences: validTexts.map((text) => ({ text, citations: [] })),
    });
  }

  const { borrower, management, competitive, market, industry, transaction, synthesis } = result;

  // Industry sections
  if (industry) {
    addSection("Industry Overview", industry.industry_size_and_growth, industry.key_trends);
    addSection(
      "Industry Outlook",
      industry.five_year_outlook,
      industry.disruption_risks,
      industry.credit_risk_profile,
    );
    addSection("Regulatory Environment", industry.regulatory_landscape, industry.margin_environment);
  }

  // Competitive
  if (competitive) {
    const competitorProse =
      competitive.direct_competitors
        .map(
          (c) =>
            `${c.name}: ${c.description} Strengths: ${c.strengths} Weaknesses: ${c.weaknesses} Position: ${c.market_position}`,
        )
        .join("\n") || undefined;
    addSection(
      "Competitive Landscape",
      competitive.competitive_dynamics,
      competitive.borrower_positioning,
      competitorProse,
    );
  }

  // Market
  if (market) {
    addSection(
      "Market Intelligence",
      market.local_economic_conditions,
      market.demographic_trends,
      market.demand_drivers,
      market.area_specific_risks,
    );
  }

  // Borrower profile + litigation
  if (borrower) {
    addSection(
      "Borrower Profile",
      borrower.company_overview,
      borrower.reputation_and_reviews,
      borrower.recent_news,
      borrower.customer_base_and_reach,
    );
    addSection("Litigation and Risk", borrower.litigation_and_risk);
  }

  // Management — per-sentence construction preserves field separation
  if (management) {
    const mgmtSentences: { text: string; citations: never[] }[] = [];
    for (const p of management.principal_profiles.slice(0, 5)) {
      if (p.name && p.background) mgmtSentences.push({ text: `${p.name}: ${p.background}`, citations: [] });
      if (p.other_ventures) mgmtSentences.push({ text: p.other_ventures, citations: [] });
      if (p.track_record) mgmtSentences.push({ text: p.track_record, citations: [] });
      if (p.red_flags) mgmtSentences.push({ text: p.red_flags, citations: [] });
    }
    if (management.management_depth) mgmtSentences.push({ text: management.management_depth, citations: [] });
    if (management.key_person_risk) mgmtSentences.push({ text: management.key_person_risk, citations: [] });
    if (management.ownership_and_governance) mgmtSentences.push({ text: management.ownership_and_governance, citations: [] });
    if (mgmtSentences.length > 0) sections.push({ title: "Management Intelligence", sentences: mgmtSentences });
  }

  // Transaction
  if (transaction) {
    addSection(
      "Transaction Analysis",
      transaction.primary_repayment_source,
      transaction.secondary_repayment_source,
      transaction.repayment_vulnerabilities,
      transaction.structure_alignment,
      transaction.collateral_adequacy,
      transaction.downside_case,
      transaction.stress_scenario,
    );
  }

  // Synthesis
  if (synthesis) {
    addSection("Credit Thesis", synthesis.executive_credit_thesis);
    if (synthesis.structure_implications.length > 0) {
      addSection("Structure Implications", synthesis.structure_implications.join("\n"));
    }
    if (synthesis.underwriting_questions.length > 0) {
      addSection("Underwriting Questions", synthesis.underwriting_questions.join("\n"));
    }
    if (synthesis.monitoring_triggers.length > 0) {
      addSection("Monitoring Triggers", synthesis.monitoring_triggers.join("\n"));
    }
    if (synthesis.contradictions_and_uncertainties.length > 0) {
      addSection("Contradictions", synthesis.contradictions_and_uncertainties.join("\n"));
    }
    addSection("3-Year and 5-Year Outlook", synthesis.three_year_outlook, synthesis.five_year_outlook);
  }

  // BIE metadata section — encodes quality + source count for loadResearchForMemo
  const metaPayload = JSON.stringify({
    research_quality_score: synthesis?.research_quality_score ?? "Moderate",
    sources_count: result.sources_used.length,
  });
  sections.push({
    title: "BIE Sources",
    sentences: [
      { text: `BIE_META:${metaPayload}`, citations: [] },
      ...result.sources_used.slice(0, 20).map((url) => ({ text: url, citations: [] })),
    ],
  });

  return sections;
}
