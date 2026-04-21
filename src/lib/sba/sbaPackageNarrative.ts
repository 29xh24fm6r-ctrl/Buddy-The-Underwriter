import "server-only";

import type { SensitivityScenario, ManagementMember } from "./sbaReadinessTypes";
import { MODEL_SBA_NARRATIVE, isGemini3Model } from "@/lib/ai/models";

const GEMINI_MODEL = MODEL_SBA_NARRATIVE;

const GEMINI_API_URL = (apiKey: string) =>
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

function safeParseField(text: string, field: string, fallback: string): string {
  try {
    const parsed = JSON.parse(text);
    return typeof parsed[field] === "string" ? parsed[field] : fallback;
  } catch {
    return text.length > 50 ? text : fallback;
  }
}

// Phase 3 — exported so sbaAssumptionDrafter and other narrative callers can
// reuse the Gemini 3.x-aware config (no temperature, thinkingBudget=1024) and
// JSON response handling without duplicating it.
export async function callGeminiJSON(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[sbaPackageNarrative] GEMINI_API_KEY not set");
    return "";
  }

  // Phase 2 — Gemini 3.x family (e.g. gemini-3.1-pro-preview) needs a non-zero
  // thinkingBudget to produce quality output and MUST NOT carry a temperature
  // field (the server warns and can loop below 1.0). Non-3.x models keep the
  // previous fast-path config.
  const isGemini3 = isGemini3Model(GEMINI_MODEL);
  const generationConfig: Record<string, unknown> = {
    responseMimeType: "application/json",
    maxOutputTokens: 8192,
    thinkingConfig: { thinkingBudget: isGemini3 ? 1024 : 0 },
  };
  if (!isGemini3) {
    generationConfig.temperature = 0.7;
  }

  const resp = await fetch(GEMINI_API_URL(apiKey), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`gemini_sba_narrative_${resp.status}: ${errText.slice(0, 300)}`);
  }

  const json = await resp.json();
  const text: string =
    json?.candidates?.[0]?.content?.parts
      ?.filter((p: { thought?: boolean }) => !p.thought)
      ?.map((p: { text?: string }) => p.text ?? "")
      ?.join("") ?? "";

  return text;
}

/** Call 1: Section 1 — Business Overview (Phase 2 — richer context). */
export async function generateBusinessOverviewNarrative(params: {
  dealName: string;
  loanType: string;
  loanAmount: number;
  managementTeam: ManagementMember[];
  revenueStreamNames: string[];
  useOfProceedsDescription: string;
  researchSummary?: string;
  // Phase 2 additions
  city?: string | null;
  state?: string | null;
  managementBios?: string;
  borrowerProfile?: string | null;
}): Promise<string> {
  const locationLine = params.city
    ? `${params.city}${params.state ? `, ${params.state}` : ""}`
    : "Location not specified";

  const prompt = `You are writing a business plan narrative for an SBA ${params.loanType.replace("_", " ").toUpperCase()} loan application.
Tone: professional, factual, optimistic but grounded. Write in third person.
RULES: Do NOT invent market statistics. Do NOT use superlatives. Do NOT mention loan approval, denial, creditworthiness, or risk grade.
Every claim must be directly supportable from the inputs provided. Name the borrower, their city/state, and each management team member by name.

Borrower: ${params.dealName}
Location: ${locationLine}
Loan amount: $${params.loanAmount.toLocaleString()}

Management team with bios:
${params.managementBios || JSON.stringify(params.managementTeam)}

Revenue streams: ${params.revenueStreamNames.join(", ")}
Use of proceeds: ${params.useOfProceedsDescription}

${params.borrowerProfile ? `Borrower profile from Buddy research:\n${params.borrowerProfile}\n` : ""}${params.researchSummary ? `Other market research context:\n${params.researchSummary}\n` : ""}
Return ONLY valid JSON with this exact shape and no other text:
{
  "companyDescription": "2 paragraphs: what the business does, how long it has operated, key markets served, by name and location.",
  "productsAndServices": "1 paragraph: what products or services are offered.",
  "marketOpportunity": "1 paragraph: market context from the supplied research only — no invented statistics.",
  "managementTeam": "1–2 sentences per team member by name: title, years in industry, relevant background.",
  "useOfProceeds": "1 paragraph: how loan proceeds will be deployed and expected business impact.",
  "fullNarrative": "all five sections joined with section headers: Company Description, Products & Services, Market Opportunity, Management Team, Use of Proceeds."
}`;

  try {
    const text = await callGeminiJSON(prompt);
    return safeParseField(text, "fullNarrative", "Business overview not available.");
  } catch (err) {
    console.error("[sbaPackageNarrative] generateBusinessOverviewNarrative error:", err);
    return "Business overview not available.";
  }
}

// ─── Phase BPG — Business Plan God Tier narrative generators ─────────────────
// All guarded by the standard Gemini rules: no invented stats, no superlatives,
// no mention of loan approval/denial/creditworthiness/risk grade.
// Every function returns a fallback string on error and never throws.

const STANDARD_GUARDRAILS =
  "Do NOT invent market statistics. Do NOT use superlatives. Do NOT mention loan approval, denial, creditworthiness, or risk grade.";

/** Phase BPG / Phase 2 — Executive summary (≤500 words) with full deal context. */
export async function generateExecutiveSummary(params: {
  dealName: string;
  loanType: string;
  loanAmount: number;
  industryDescription: string;
  revenueStreamNames: string[];
  managementLeadNames: string[];
  useOfProceedsDescription: string;
  dscrYear1: number;
  projectedRevenueYear1: number;
  yearsInBusiness?: number;
  // Phase 2 additions
  managementBios?: string; // formatted "Name (Title, X% ownership, Y years): bio"
  city?: string | null;
  state?: string | null;
  borrowerProfile?: string | null; // from research extractor
  creditThesis?: string | null; // from research extractor
  equityInjectionPct?: number; // 0-1 decimal
}): Promise<string> {
  const locationLine = params.city
    ? `${params.city}${params.state ? `, ${params.state}` : ""}`
    : "Location not specified";
  const dscrPasses = params.dscrYear1 >= 1.25;

  const prompt = `You are writing the executive summary for an SBA ${params.loanType.replace(/_/g, " ").toUpperCase()} business plan.
${STANDARD_GUARDRAILS}
Maximum 500 words. Third person, professional, grounded.

CRITICAL INSTRUCTION: This must read like it was written specifically about ${params.dealName}. Use the borrower's name, their specific loan amount, their specific city/state, their specific management team members by name, and their specific DSCR. A reader should know within the first sentence exactly which business this plan is about.

OPENING SENTENCE TEMPLATE (adapt to the data):
"${params.dealName}, a ${params.industryDescription || "small"} business located in ${locationLine}, is requesting a $${params.loanAmount.toLocaleString()} SBA ${params.loanType.replace(/_/g, " ")} loan to ${params.useOfProceedsDescription}."

Borrower: ${params.dealName}
Location: ${locationLine}
Industry: ${params.industryDescription}
Years in business: ${params.yearsInBusiness ?? "Not specified"}
Requested loan: $${params.loanAmount.toLocaleString()}
Use of proceeds: ${params.useOfProceedsDescription}
Revenue streams: ${params.revenueStreamNames.join(", ") || "Not specified"}
Management team (names): ${params.managementLeadNames.join(", ") || "Not specified"}

Management team with bios:
${params.managementBios || "Bios not supplied"}

Projected Year 1 revenue: $${Math.round(params.projectedRevenueYear1).toLocaleString()}
Year 1 DSCR: ${params.dscrYear1.toFixed(2)}x (SBA minimum: 1.25x — ${dscrPasses ? "PASSES" : "BELOW THRESHOLD"})
Equity injection: ${params.equityInjectionPct !== undefined ? `${(params.equityInjectionPct * 100).toFixed(1)}%` : "Not specified"}

${params.borrowerProfile ? `Borrower research context:\n${params.borrowerProfile}\n` : ""}${params.creditThesis ? `Credit thesis:\n${params.creditThesis}\n` : ""}
Structure the narrative as:
1. Opening sentence as templated above.
2. Business overview and operating history (2–3 sentences).
3. Revenue model and year-1 projected performance (2–3 sentences with actual numbers).
4. Management strength — reference each team member by name with their relevant experience.
5. Debt service capacity — state the projected DSCR as a fact, note the cushion above or the gap below SBA's 1.25x minimum.
6. Closing statement on why this request is structured to succeed.

Return ONLY valid JSON:
{ "executiveSummary": "..." }`;

  try {
    const text = await callGeminiJSON(prompt);
    return safeParseField(
      text,
      "executiveSummary",
      "Executive summary not available.",
    );
  } catch (err) {
    console.error("[sbaPackageNarrative] generateExecutiveSummary error:", err);
    return "Executive summary not available.";
  }
}

/** Phase BPG / Phase 2 — Industry analysis with structured research injection. */
export async function generateIndustryAnalysis(params: {
  dealName: string;
  naicsCode: string | null;
  industryDescription: string;
  researchSummary?: string; // legacy fallback
  // Phase 2 additions — labeled sections from extractResearchForBusinessPlan
  industryOverview?: string | null;
  industryOutlook?: string | null;
  competitiveLandscape?: string | null;
  regulatoryEnvironment?: string | null;
  marketIntelligence?: string | null;
}): Promise<string> {
  const section = (title: string, body: string | null | undefined) =>
    body ? `=== ${title} (from Buddy research) ===\n${body}\n\n` : "";

  const anyResearch =
    params.industryOverview ||
    params.industryOutlook ||
    params.competitiveLandscape ||
    params.regulatoryEnvironment ||
    params.marketIntelligence ||
    params.researchSummary;

  const prompt = `You are writing the industry analysis section for an SBA business plan.
${STANDARD_GUARDRAILS}

CRITICAL: Use ONLY the research data provided below. Do NOT invent any statistics, market sizes, growth rates, or competitor names that are not explicitly stated in the research context. If a research section is missing or says "data not available", acknowledge the gap honestly rather than filling it with generic filler.

Borrower: ${params.dealName}
NAICS: ${params.naicsCode ?? "Not provided"}
Industry: ${params.industryDescription}

${section("INDUSTRY OVERVIEW", params.industryOverview)}${section("INDUSTRY OUTLOOK", params.industryOutlook)}${section("COMPETITIVE LANDSCAPE", params.competitiveLandscape)}${section("REGULATORY ENVIRONMENT", params.regulatoryEnvironment)}${section("LOCAL MARKET INTELLIGENCE", params.marketIntelligence)}${!anyResearch ? "(No Buddy research available — write a conservative, descriptive overview without specific statistics.)\n" : ""}
Write 4-5 paragraphs covering:
1. Industry landscape and size (from research ONLY — no invented numbers).
2. Growth drivers and demand trends.
3. Competitive positioning for ${params.dealName}.
4. Regulatory or input-cost considerations.
5. Local market context if geographic data is available.

Return ONLY valid JSON:
{ "industryAnalysis": "..." }`;

  try {
    const text = await callGeminiJSON(prompt);
    return safeParseField(
      text,
      "industryAnalysis",
      "Industry analysis not available.",
    );
  } catch (err) {
    console.error("[sbaPackageNarrative] generateIndustryAnalysis error:", err);
    return "Industry analysis not available.";
  }
}

/** Phase BPG / Phase 2 — Marketing strategy + Operations plan. */
export async function generateMarketingAndOperations(params: {
  dealName: string;
  industryDescription: string;
  revenueStreamNames: string[];
  plannedHires: Array<{ role: string; annualSalary: number }>;
  useOfProceedsDescription: string;
  // Phase 2 additions
  city?: string | null;
  state?: string | null;
  marketIntelligence?: string | null;
  competitiveLandscape?: string | null;
}): Promise<{ marketingStrategy: string; operationsPlan: string }> {
  const locationLine = params.city
    ? `${params.city}${params.state ? `, ${params.state}` : ""}`
    : "Location not specified";

  const prompt = `You are writing the Marketing Strategy and Operations Plan sections of an SBA business plan.
${STANDARD_GUARDRAILS}
Ground every statement in the borrower inputs. Reference the borrower's actual city/state and actual planned hires by role.

Borrower: ${params.dealName}
Location: ${locationLine}
Industry: ${params.industryDescription}
Revenue streams: ${params.revenueStreamNames.join(", ") || "Not specified"}
Planned hires: ${params.plannedHires.map((h) => `${h.role} ($${h.annualSalary.toLocaleString()}/yr)`).join("; ") || "None specified"}
Use of proceeds: ${params.useOfProceedsDescription}

${params.marketIntelligence ? `Local market intelligence (from research):\n${params.marketIntelligence}\n` : ""}${params.competitiveLandscape ? `Competitive landscape (from research):\n${params.competitiveLandscape}\n` : ""}
Return ONLY valid JSON:
{
  "marketingStrategy": "2-3 paragraphs: target customer, channels, pricing and sales approach, how loan proceeds (if marketing-related) will grow demand.",
  "operationsPlan": "2-3 paragraphs: facility and location (reference actual city/state), staffing plan linked to the planned hires above by role, key suppliers or workflow, how the loan strengthens operations."
}`;

  try {
    const text = await callGeminiJSON(prompt);
    return {
      marketingStrategy: safeParseField(
        text,
        "marketingStrategy",
        "Marketing strategy not available.",
      ),
      operationsPlan: safeParseField(
        text,
        "operationsPlan",
        "Operations plan not available.",
      ),
    };
  } catch (err) {
    console.error(
      "[sbaPackageNarrative] generateMarketingAndOperations error:",
      err,
    );
    return {
      marketingStrategy: "Marketing strategy not available.",
      operationsPlan: "Operations plan not available.",
    };
  }
}

/** Phase BPG / Phase 2 — SWOT analysis with deal-specific anchoring. */
export async function generateSWOTAnalysis(params: {
  dealName: string;
  industryDescription: string;
  managementTeam: ManagementMember[];
  revenueStreamNames: string[];
  dscrYear1: number;
  marginOfSafetyPct: number;
  // Phase 2 additions
  managementBios?: string;
  borrowerProfile?: string | null;
  competitiveLandscape?: string | null;
  industryOutlook?: string | null;
}): Promise<{
  strengths: string;
  weaknesses: string;
  opportunities: string;
  threats: string;
}> {
  const prompt = `You are writing a SWOT analysis for an SBA business plan.
${STANDARD_GUARDRAILS}
Keep each section to 3-5 concise bullet-style sentences.

CRITICAL: Strengths and weaknesses must reference specific facts about THIS business — team members by name, specific DSCR numbers, specific margin of safety percentage. Generic SWOT items like "strong management team" without naming anyone are unacceptable. Opportunities and threats should cite the provided industry outlook or competitive landscape facts when available.

Borrower: ${params.dealName}
Industry: ${params.industryDescription}
Revenue streams: ${params.revenueStreamNames.join(", ")}
Year 1 DSCR: ${params.dscrYear1.toFixed(2)}x
Break-even margin of safety: ${(params.marginOfSafetyPct * 100).toFixed(1)}%

Management team detail:
${params.managementBios || JSON.stringify(params.managementTeam)}

${params.borrowerProfile ? `Borrower profile from research:\n${params.borrowerProfile}\n` : ""}${params.competitiveLandscape ? `Competitive landscape:\n${params.competitiveLandscape}\n` : ""}${params.industryOutlook ? `Industry outlook:\n${params.industryOutlook}\n` : ""}
Return ONLY valid JSON:
{
  "strengths": "Internal positives — team experience (by name), DSCR cushion (actual number), margin-of-safety (actual %), operational advantages.",
  "weaknesses": "Internal constraints — concentration risk, thin margins, experience gaps named specifically, working capital needs.",
  "opportunities": "External tailwinds the borrower could capture — cite industry outlook facts if provided.",
  "threats": "External risks — competitive, regulatory, input cost volatility, macro sensitivity. Cite competitive landscape facts if provided."
}`;

  try {
    const text = await callGeminiJSON(prompt);
    return {
      strengths: safeParseField(text, "strengths", "Strengths not available."),
      weaknesses: safeParseField(
        text,
        "weaknesses",
        "Weaknesses not available.",
      ),
      opportunities: safeParseField(
        text,
        "opportunities",
        "Opportunities not available.",
      ),
      threats: safeParseField(text, "threats", "Threats not available."),
    };
  } catch (err) {
    console.error("[sbaPackageNarrative] generateSWOTAnalysis error:", err);
    return {
      strengths: "Strengths not available.",
      weaknesses: "Weaknesses not available.",
      opportunities: "Opportunities not available.",
      threats: "Threats not available.",
    };
  }
}

/** Phase BPG — Franchise section (Tier 3 franchise deals only). */
export async function generateFranchiseSection(params: {
  dealName: string;
  franchiseBrand: string;
  fddItem7Min?: number;
  fddItem7Max?: number;
  fddItem19Avg?: number;
  unitCount?: number;
  territoryDescription?: string;
}): Promise<string> {
  const prompt = `You are writing the Franchise section of an SBA business plan.
${STANDARD_GUARDRAILS}
Only reference figures that are explicitly provided in the inputs. If a figure is absent, describe the category qualitatively instead of inventing numbers.

Borrower: ${params.dealName}
Franchise brand: ${params.franchiseBrand}
FDD Item 7 initial investment range: ${params.fddItem7Min ? `$${params.fddItem7Min.toLocaleString()}` : "Not provided"} - ${params.fddItem7Max ? `$${params.fddItem7Max.toLocaleString()}` : "Not provided"}
FDD Item 19 representative unit average: ${params.fddItem19Avg ? `$${params.fddItem19Avg.toLocaleString()}` : "Not provided"}
Unit count: ${params.unitCount ?? "Not provided"}
Territory: ${params.territoryDescription ?? "Not provided"}

Return ONLY valid JSON:
{
  "franchiseSection": "3-4 paragraphs: franchise brand overview and franchisor support; initial investment range with Item 7 context if provided; representative unit performance with Item 19 context if provided; territory and unit-count rationale; alignment of this franchisee's plan with brand standards."
}`;

  try {
    const text = await callGeminiJSON(prompt);
    return safeParseField(
      text,
      "franchiseSection",
      "Franchise section not available.",
    );
  } catch (err) {
    console.error("[sbaPackageNarrative] generateFranchiseSection error:", err);
    return "Franchise section not available.";
  }
}

/** Call 2: Section 5 — Sensitivity Commentary */
export async function generateSensitivityNarrative(params: {
  scenarios: SensitivityScenario[];
  breakEvenMarginOfSafetyPct: number;
  year1MinCumulativeCash: number;
  loanType: string;
}): Promise<string> {
  const base = params.scenarios.find((s) => s.name === "base");
  const downside = params.scenarios.find((s) => s.name === "downside");

  const prompt = `You are a commercial banker summarizing a sensitivity analysis for an SBA ${params.loanType.replace("_", " ").toUpperCase()} credit package.
RULES: Do NOT mention loan approval, denial, creditworthy, or risk grade. State facts. Use plain language.
The SBA minimum DSCR is 1.25x. Flag any scenario year below this threshold.

Base DSCR Y1/Y2/Y3: ${base?.dscrYear1.toFixed(2) ?? "N/A"}/${base?.dscrYear2.toFixed(2) ?? "N/A"}/${base?.dscrYear3.toFixed(2) ?? "N/A"}
Downside DSCR Y1/Y2/Y3: ${downside?.dscrYear1.toFixed(2) ?? "N/A"}/${downside?.dscrYear2.toFixed(2) ?? "N/A"}/${downside?.dscrYear3.toFixed(2) ?? "N/A"}
Break-even margin of safety: ${(params.breakEvenMarginOfSafetyPct * 100).toFixed(1)}%
Year 1 minimum cumulative cash: $${Math.round(params.year1MinCumulativeCash).toLocaleString()}

Return ONLY valid JSON:
{
  "narrative": "2–3 paragraphs: (1) base case summary, (2) downside risk assessment with specific numbers, (3) recommended actions if downside materializes"
}`;

  try {
    const text = await callGeminiJSON(prompt);
    return safeParseField(text, "narrative", "Sensitivity analysis not available.");
  } catch (err) {
    console.error("[sbaPackageNarrative] generateSensitivityNarrative error:", err);
    return "Sensitivity analysis not available.";
  }
}
