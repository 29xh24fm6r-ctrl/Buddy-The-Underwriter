import "server-only";

import type { SensitivityScenario, ManagementMember } from "./sbaReadinessTypes";
import { MODEL_SBA_NARRATIVE } from "@/lib/ai/models";

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

async function callGeminiJSON(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[sbaPackageNarrative] GEMINI_API_KEY not set");
    return "";
  }

  const resp = await fetch(GEMINI_API_URL(apiKey), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 },
      },
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

/** Call 1: Section 1 — Business Overview */
export async function generateBusinessOverviewNarrative(params: {
  dealName: string;
  loanType: string;
  loanAmount: number;
  managementTeam: ManagementMember[];
  revenueStreamNames: string[];
  useOfProceedsDescription: string;
  researchSummary?: string;
}): Promise<string> {
  const prompt = `You are writing a business plan narrative for an SBA ${params.loanType.replace("_", " ").toUpperCase()} loan application.
Tone: professional, factual, optimistic but grounded. Write in third person.
RULES: Do NOT invent market statistics. Do NOT use superlatives. Do NOT mention loan approval, denial, creditworthiness, or risk grade.
Every claim must be directly supportable from the inputs provided.

Borrower: ${params.dealName}
Loan amount: $${params.loanAmount.toLocaleString()}
Management team: ${JSON.stringify(params.managementTeam)}
Revenue streams: ${params.revenueStreamNames.join(", ")}
Use of proceeds: ${params.useOfProceedsDescription}
Market research context: ${params.researchSummary ?? "Not available"}

Return ONLY valid JSON with this exact shape and no other text:
{
  "companyDescription": "2 paragraphs: what the business does, how long it has operated, key markets served",
  "productsAndServices": "1 paragraph: what products or services are offered",
  "marketOpportunity": "1 paragraph: market context from research only — no invented statistics",
  "managementTeam": "1–2 sentences per team member: name, title, years in industry, relevant background",
  "useOfProceeds": "1 paragraph: how loan proceeds will be deployed and expected business impact",
  "fullNarrative": "all five sections joined with section headers: Company Description, Products & Services, Market Opportunity, Management Team, Use of Proceeds"
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

/** Phase BPG — Executive summary (≤400 words). */
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
}): Promise<string> {
  const prompt = `You are writing the executive summary for an SBA ${params.loanType.replace(/_/g, " ").toUpperCase()} business plan.
${STANDARD_GUARDRAILS}
Maximum 400 words. Write in third person, professional and grounded tone. Every claim must be supportable from the inputs.

Borrower: ${params.dealName}
Industry: ${params.industryDescription}
Years in business: ${params.yearsInBusiness ?? "Not specified"}
Requested loan: $${params.loanAmount.toLocaleString()}
Use of proceeds: ${params.useOfProceedsDescription}
Revenue streams: ${params.revenueStreamNames.join(", ") || "Not specified"}
Management: ${params.managementLeadNames.join(", ") || "Not specified"}
Projected Year 1 revenue: $${Math.round(params.projectedRevenueYear1).toLocaleString()}
Year 1 DSCR: ${params.dscrYear1.toFixed(2)}x

Return ONLY valid JSON with this exact shape:
{
  "executiveSummary": "A single 400-word narrative covering: (1) company and industry, (2) request and use of proceeds, (3) revenue streams and year-1 outlook, (4) management strength, (5) debt service capacity stated as a factual DSCR. No headers — flowing prose."
}`;

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

/** Phase BPG — Industry analysis (NAICS-anchored). */
export async function generateIndustryAnalysis(params: {
  dealName: string;
  naicsCode: string | null;
  industryDescription: string;
  researchSummary?: string;
}): Promise<string> {
  const prompt = `You are writing the industry analysis section for an SBA business plan.
${STANDARD_GUARDRAILS}
Anchor the analysis on the provided NAICS code and borrower's industry description. Do not cite figures that are not in the provided research context.

Borrower: ${params.dealName}
NAICS code: ${params.naicsCode ?? "Not provided"}
Industry description: ${params.industryDescription}
Research context: ${params.researchSummary ?? "Not provided — write a conservative, descriptive overview without specific statistics."}

Return ONLY valid JSON:
{
  "industryAnalysis": "3-4 paragraphs: industry landscape, typical customer profile and demand drivers, competitive dynamics, regulatory or input-cost factors borrowers in this NAICS should acknowledge."
}`;

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

/** Phase BPG — Marketing strategy + Operations plan. */
export async function generateMarketingAndOperations(params: {
  dealName: string;
  industryDescription: string;
  revenueStreamNames: string[];
  plannedHires: Array<{ role: string; annualSalary: number }>;
  useOfProceedsDescription: string;
}): Promise<{ marketingStrategy: string; operationsPlan: string }> {
  const prompt = `You are writing the Marketing Strategy and Operations Plan sections of an SBA business plan.
${STANDARD_GUARDRAILS}
Ground every statement in the borrower inputs.

Borrower: ${params.dealName}
Industry: ${params.industryDescription}
Revenue streams: ${params.revenueStreamNames.join(", ") || "Not specified"}
Planned hires: ${params.plannedHires.map((h) => `${h.role} ($${h.annualSalary.toLocaleString()}/yr)`).join("; ") || "None specified"}
Use of proceeds: ${params.useOfProceedsDescription}

Return ONLY valid JSON:
{
  "marketingStrategy": "2-3 paragraphs: target customer, channels, pricing and sales approach, how loan proceeds (if marketing-related) will grow demand.",
  "operationsPlan": "2-3 paragraphs: facility and location, staffing plan linked to the planned hires above, key suppliers or workflow, how the loan strengthens operations."
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

/** Phase BPG — SWOT analysis. */
export async function generateSWOTAnalysis(params: {
  dealName: string;
  industryDescription: string;
  managementTeam: ManagementMember[];
  revenueStreamNames: string[];
  dscrYear1: number;
  marginOfSafetyPct: number;
}): Promise<{
  strengths: string;
  weaknesses: string;
  opportunities: string;
  threats: string;
}> {
  const prompt = `You are writing a SWOT analysis for an SBA business plan.
${STANDARD_GUARDRAILS}
Keep each section to 3-5 concise bullet-style sentences. Concrete, specific, grounded in the inputs.

Borrower: ${params.dealName}
Industry: ${params.industryDescription}
Management: ${JSON.stringify(params.managementTeam)}
Revenue streams: ${params.revenueStreamNames.join(", ")}
Year 1 DSCR: ${params.dscrYear1.toFixed(2)}x
Break-even margin of safety: ${(params.marginOfSafetyPct * 100).toFixed(1)}%

Return ONLY valid JSON:
{
  "strengths": "Internal positives — team experience, existing revenue base, DSCR cushion, operational advantages.",
  "weaknesses": "Internal constraints — concentration risk, thin margins, experience gaps, working capital needs.",
  "opportunities": "External tailwinds the borrower could capture — market trends, expansion channels, adjacent segments.",
  "threats": "External risks — competitive, regulatory, input cost volatility, macro sensitivity."
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
