import "server-only";

import type {
  SensitivityScenario,
  ManagementMember,
  RevenueStream,
} from "./sbaReadinessTypes";
import type { BorrowerStory } from "./sbaBorrowerStory";
import { MODEL_SBA_NARRATIVE, isGemini3Model } from "@/lib/ai/models";

/**
 * Per-stream summary used in narrative prompts. When 2+ summaries are
 * supplied to generateBusinessOverviewNarrative, the prompt instructs
 * the LLM to describe each stream by name in Products & Services
 * instead of treating the streams as an undifferentiated comma list.
 */
export type RevenueStreamSummary = {
  name: string;
  pricingModel: RevenueStream["pricingModel"];
  baseAnnualRevenue: number;
  growthRateYear1: number;
};

function formatStreamsForPrompt(
  summaries: RevenueStreamSummary[] | undefined,
  fallbackNames: string[],
): string {
  if (!summaries || summaries.length === 0) {
    return fallbackNames.join(", ") || "Not specified";
  }
  return summaries
    .map(
      (s) =>
        `- ${s.name} (${s.pricingModel} pricing): base $${Math.round(
          s.baseAnnualRevenue,
        ).toLocaleString()}/yr, ${(s.growthRateYear1 * 100).toFixed(1)}% Y1 growth`,
    )
    .join("\n");
}

const GEMINI_MODEL = MODEL_SBA_NARRATIVE;

// ─── BorrowerStory helpers ────────────────────────────────────────────────
// A story is OPTIONAL. When present, it injects the borrower's own voice
// into every prompt. When absent, the generators fall back to the older,
// purely data-driven framing — decent, but not god-tier.

function hasStorySubstance(story: BorrowerStory | null | undefined): boolean {
  if (!story) return false;
  const nonEmpty = (s: string | null) =>
    typeof s === "string" && s.trim().length > 0;
  return (
    nonEmpty(story.originStory) ||
    nonEmpty(story.competitiveInsight) ||
    nonEmpty(story.idealCustomer) ||
    nonEmpty(story.growthStrategy) ||
    nonEmpty(story.biggestRisk) ||
    nonEmpty(story.personalVision)
  );
}

function formatStoryForPrompt(story: BorrowerStory | null | undefined): string {
  if (!hasStorySubstance(story)) return "";
  const s = story as BorrowerStory;
  const lines: string[] = [
    "THE BORROWER'S STORY (their own words, captured in discovery interview):",
  ];
  if (s.originStory?.trim()) {
    lines.push(`Why they started this business:\n${s.originStory.trim()}`);
  }
  if (s.competitiveInsight?.trim()) {
    lines.push(`Their competitive edge:\n${s.competitiveInsight.trim()}`);
  }
  if (s.idealCustomer?.trim()) {
    lines.push(`Their ideal customer:\n${s.idealCustomer.trim()}`);
  }
  if (s.growthStrategy?.trim()) {
    lines.push(`Their growth plan:\n${s.growthStrategy.trim()}`);
  }
  if (s.biggestRisk?.trim()) {
    lines.push(`Their biggest perceived risk:\n${s.biggestRisk.trim()}`);
  }
  if (s.personalVision?.trim()) {
    lines.push(`What success looks like in 3 years:\n${s.personalVision.trim()}`);
  }
  lines.push(
    "USE THESE WORDS. Quote or paraphrase directly where natural. Do not translate them into corporate jargon. The reader should recognize the borrower's voice in the writing.",
  );
  return lines.join("\n\n") + "\n";
}

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
  /**
   * When provided (length ≥ 2), Products & Services is rewritten to
   * describe each stream individually rather than treating them as a
   * single comma list. Falls back to revenueStreamNames otherwise.
   */
  revenueStreamSummaries?: RevenueStreamSummary[];
  useOfProceedsDescription: string;
  researchSummary?: string;
  // Phase 2 additions
  city?: string | null;
  state?: string | null;
  managementBios?: string;
  borrowerProfile?: string | null;
  // God Tier additions
  story?: BorrowerStory | null;
  planThesis?: string | null;
}): Promise<string> {
  const locationLine = params.city
    ? `${params.city}${params.state ? `, ${params.state}` : ""}`
    : "Location not specified";
  const storyBlock = formatStoryForPrompt(params.story);
  const storyPresent = storyBlock.length > 0;

  const prompt = `You are writing a business plan narrative for an SBA ${params.loanType.replace("_", " ").toUpperCase()} loan application.
Tone: professional, factual, optimistic but grounded. Write in third person.
RULES: Do NOT invent market statistics. Do NOT use superlatives. Do NOT mention loan approval, denial, creditworthiness, or risk grade.
Every claim must be directly supportable from the inputs provided. Name the borrower, their city/state, and each management team member by name.
${storyPresent ? "\nThe borrower's origin story must open the Company Description. The borrower's competitive insight must anchor the Market Opportunity section. The borrower's ideal-customer description must inform Products & Services. When a section would be generic without the story, acknowledge the gap rather than padding.\n" : ""}

${params.planThesis ? `PLAN THESIS (every section must support this):\n${params.planThesis}\n` : ""}${storyBlock}

Borrower: ${params.dealName}
Location: ${locationLine}
Loan amount: $${params.loanAmount.toLocaleString()}

Management team with bios:
${params.managementBios || JSON.stringify(params.managementTeam)}

Revenue streams:
${formatStreamsForPrompt(params.revenueStreamSummaries, params.revenueStreamNames)}
Use of proceeds: ${params.useOfProceedsDescription}

${params.borrowerProfile ? `Borrower profile from Buddy research:\n${params.borrowerProfile}\n` : ""}${params.researchSummary ? `Other market research context:\n${params.researchSummary}\n` : ""}
Return ONLY valid JSON with this exact shape and no other text:
{
  "companyDescription": "2 paragraphs: what the business does, how long it has operated, key markets served, by name and location.${storyPresent ? " Open with the borrower's origin story translated into third person prose." : ""}",
  "productsAndServices": "${(params.revenueStreamSummaries?.length ?? 0) >= 2 ? "One short paragraph per revenue stream listed above, in the same order. Lead each paragraph with the stream name in bold (e.g. **Auto Sales** —) and describe what that stream sells, who it serves, and how it earns revenue. Do not merge streams into a single paragraph." : `1 paragraph: what products or services are offered${storyPresent ? " and who they're for, drawing on the borrower's ideal-customer description" : ""}.`}",
  "marketOpportunity": "1 paragraph: market context from the supplied research only — no invented statistics.${storyPresent ? " Anchor with the borrower's competitive insight." : ""}",
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
  // God Tier additions
  story?: BorrowerStory | null;
  planThesis?: string | null;
}): Promise<string> {
  const locationLine = params.city
    ? `${params.city}${params.state ? `, ${params.state}` : ""}`
    : "Location not specified";
  const dscrPasses = params.dscrYear1 >= 1.25;
  const storyBlock = formatStoryForPrompt(params.story);
  const storyPresent = storyBlock.length > 0;

  const godTierHookRules = `YOUR FIRST SENTENCE IS THE HOOK. It must make a reader — a bank officer, the borrower's spouse, the borrower themselves — want to keep reading. Forbidden openings: "Company X operates in the Y sector", "Business X is a small business", "X is a borrower located in Y". Instead, open with one of:
  (a) the borrower's specific competitive insight, translated into a grounded claim about the market;
  (b) a surprising or specific fact about THIS business (a number, a relationship, a place, a decade of operation);
  (c) the specific opportunity this loan unlocks, named concretely rather than abstractly.
The borrower's name, location, loan amount, and Year 1 DSCR must all appear by the end of the first paragraph — just not necessarily the first sentence.

Every growth projection must cite a specific action from the borrower's growth strategy (if one was captured). Every dollar of loan proceeds must be tied to a specific business outcome. A reader should know within 3 sentences that this plan was NOT generated from a template.`;

  const fallbackOpeningGuidance = `OPENING SENTENCE TEMPLATE (acceptable fallback only if no story is available):
"${params.dealName}, a ${params.industryDescription || "small"} business located in ${locationLine}, is requesting a $${params.loanAmount.toLocaleString()} SBA ${params.loanType.replace(/_/g, " ")} loan to ${params.useOfProceedsDescription}."`;

  const prompt = `You are the world's greatest business plan writer. You have just spent time with ${params.dealName}, learning their story. Now write an executive summary that reads like a human consultant wrote it — warm but grounded, specific but concise, confident without hype.

${STANDARD_GUARDRAILS}
Maximum 500 words. Third person. Write with warmth — like a consultant who genuinely believes in this business.

${params.planThesis ? `PLAN THESIS (the executive summary must express this thesis in the first two paragraphs):\n${params.planThesis}\n` : ""}${storyBlock}

${storyPresent ? godTierHookRules : fallbackOpeningGuidance}

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
1. A hook opening (per rules above) that names the business and the opportunity.
2. Business overview and operating history (2–3 sentences). ${storyPresent ? "Draw on the borrower's origin story for texture." : ""}
3. Revenue model and Year 1 projected performance (2–3 sentences with actual numbers).
4. Management strength — reference each team member by name with their relevant experience.
5. Debt service capacity — state the projected DSCR as a fact, note the cushion above or the gap below SBA's 1.25x minimum.
6. Closing statement on why this specific business is structured to succeed. ${storyPresent && (params.story?.personalVision ?? "").trim() ? "If appropriate, end with a single sentence that hints at the borrower's 3-year vision without overclaiming." : ""}

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
  // God Tier additions
  story?: BorrowerStory | null;
  planThesis?: string | null;
}): Promise<string> {
  const storyBlock = formatStoryForPrompt(params.story);
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
${storyBlock ? "\nWhere the borrower's own competitive insight speaks to the industry, weave it into the Competitive Positioning paragraph in third person — the reader should feel that this analysis is coming from someone who knows this market from the inside.\n" : ""}

${params.planThesis ? `PLAN THESIS:\n${params.planThesis}\n` : ""}${storyBlock}

Borrower: ${params.dealName}
NAICS: ${params.naicsCode ?? "Not provided"}
Industry: ${params.industryDescription}

${section("INDUSTRY OVERVIEW", params.industryOverview)}${section("INDUSTRY OUTLOOK", params.industryOutlook)}${section("COMPETITIVE LANDSCAPE", params.competitiveLandscape)}${section("REGULATORY ENVIRONMENT", params.regulatoryEnvironment)}${section("LOCAL MARKET INTELLIGENCE", params.marketIntelligence)}${!anyResearch ? "(No Buddy research available — write a conservative, descriptive overview without specific statistics.)\n" : ""}
Write 4-5 paragraphs covering:
1. Industry landscape and size (from research ONLY — no invented numbers).
2. Growth drivers and demand trends.
3. Competitive positioning for ${params.dealName}${storyBlock ? " — anchor this paragraph in the borrower's stated competitive insight" : ""}.
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
  // God Tier additions
  story?: BorrowerStory | null;
  planThesis?: string | null;
}): Promise<{ marketingStrategy: string; operationsPlan: string }> {
  const locationLine = params.city
    ? `${params.city}${params.state ? `, ${params.state}` : ""}`
    : "Location not specified";
  const storyBlock = formatStoryForPrompt(params.story);
  const hasIdealCustomer = (params.story?.idealCustomer ?? "").trim().length > 0;
  const hasGrowthStrategy = (params.story?.growthStrategy ?? "").trim().length > 0;

  const prompt = `You are writing the Marketing Strategy and Operations Plan sections of an SBA business plan.
${STANDARD_GUARDRAILS}
Ground every statement in the borrower inputs. Reference the borrower's actual city/state and actual planned hires by role.
${hasGrowthStrategy ? "\nThe borrower's stated growth strategy is the BACKBONE of the marketing section. If the borrower said they'll grow through, e.g., 'referral partnerships with commercial real estate brokers,' detail THAT specific channel — do not substitute generic marketing tactics. Every channel, partnership, or tactic in the Marketing Strategy should trace back to an action the borrower actually named.\n" : ""}${hasIdealCustomer ? "The borrower's ideal-customer description must define the 'target customer' section. Reproduce their specificity — do not collapse their description into demographics.\n" : ""}

${params.planThesis ? `PLAN THESIS:\n${params.planThesis}\n` : ""}${storyBlock}

Borrower: ${params.dealName}
Location: ${locationLine}
Industry: ${params.industryDescription}
Revenue streams: ${params.revenueStreamNames.join(", ") || "Not specified"}
Planned hires: ${params.plannedHires.map((h) => `${h.role} ($${h.annualSalary.toLocaleString()}/yr)`).join("; ") || "None specified"}
Use of proceeds: ${params.useOfProceedsDescription}

${params.marketIntelligence ? `Local market intelligence (from research):\n${params.marketIntelligence}\n` : ""}${params.competitiveLandscape ? `Competitive landscape (from research):\n${params.competitiveLandscape}\n` : ""}
Return ONLY valid JSON:
{
  "marketingStrategy": "2-3 paragraphs. Structure: target customer ${hasIdealCustomer ? "(drawn directly from borrower's ideal-customer description)" : ""}, channels and tactics ${hasGrowthStrategy ? "(each traceable to the borrower's named growth actions — cite those actions by name)" : ""}, pricing and sales approach, how loan proceeds (if marketing-related) will grow demand.",
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
  // God Tier additions
  story?: BorrowerStory | null;
  planThesis?: string | null;
}): Promise<{
  strengths: string;
  weaknesses: string;
  opportunities: string;
  threats: string;
}> {
  const storyBlock = formatStoryForPrompt(params.story);
  const hasInsight = (params.story?.competitiveInsight ?? "").trim().length > 0;
  const hasGrowth = (params.story?.growthStrategy ?? "").trim().length > 0;
  const hasRisk = (params.story?.biggestRisk ?? "").trim().length > 0;

  const prompt = `You are writing a SWOT analysis for an SBA business plan.
${STANDARD_GUARDRAILS}
Keep each section to 3-5 concise bullet-style sentences.

CRITICAL: Strengths and weaknesses must reference specific facts about THIS business — team members by name, specific DSCR numbers, specific margin of safety percentage. Generic SWOT items like "strong management team" without naming anyone are unacceptable. Opportunities and threats should cite the provided industry outlook or competitive landscape facts when available.
${hasInsight ? "The borrower's stated competitive insight MUST anchor the Strengths list — translate it into a concrete strength the reader can evaluate.\n" : ""}${hasGrowth ? "The borrower's growth strategy MUST inform the Opportunities list — each opportunity should tie to a named growth action.\n" : ""}${hasRisk ? "The borrower's stated biggest risk MUST be the first item in Threats. Confronting the risk the borrower themselves named (rather than hiding it) builds reader trust.\n" : ""}

${params.planThesis ? `PLAN THESIS:\n${params.planThesis}\n` : ""}${storyBlock}

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
  "strengths": "Internal positives — team experience (by name), DSCR cushion (actual number), margin-of-safety (actual %), operational advantages.${hasInsight ? " Lead with a strength drawn from the borrower's competitive insight." : ""}",
  "weaknesses": "Internal constraints — concentration risk, thin margins, experience gaps named specifically, working capital needs.",
  "opportunities": "External tailwinds the borrower could capture — cite industry outlook facts if provided.${hasGrowth ? " Each opportunity should reference a named growth action from the borrower's plan." : ""}",
  "threats": "External risks — competitive, regulatory, input cost volatility, macro sensitivity. Cite competitive landscape facts if provided.${hasRisk ? " Lead with the borrower's own stated biggest risk." : ""}"
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
  // God Tier additions
  story?: BorrowerStory | null;
  planThesis?: string | null;
}): Promise<string> {
  const base = params.scenarios.find((s) => s.name === "base");
  const downside = params.scenarios.find((s) => s.name === "downside");
  const storyBlock = formatStoryForPrompt(params.story);
  const hasRisk = (params.story?.biggestRisk ?? "").trim().length > 0;

  const prompt = `You are a commercial banker summarizing a sensitivity analysis for an SBA ${params.loanType.replace("_", " ").toUpperCase()} credit package.
RULES: Do NOT mention loan approval, denial, creditworthy, or risk grade. State facts. Use plain language.
The SBA minimum DSCR is 1.25x. Flag any scenario year below this threshold.
${hasRisk ? "\nThe borrower has named their own biggest perceived risk. Paragraph (3) — recommended actions if downside materializes — must acknowledge that specific risk by paraphrase and describe a concrete contingency the borrower themselves could execute.\n" : ""}

${params.planThesis ? `PLAN THESIS:\n${params.planThesis}\n` : ""}${storyBlock}

Base DSCR Y1/Y2/Y3: ${base?.dscrYear1.toFixed(2) ?? "N/A"}/${base?.dscrYear2.toFixed(2) ?? "N/A"}/${base?.dscrYear3.toFixed(2) ?? "N/A"}
Downside DSCR Y1/Y2/Y3: ${downside?.dscrYear1.toFixed(2) ?? "N/A"}/${downside?.dscrYear2.toFixed(2) ?? "N/A"}/${downside?.dscrYear3.toFixed(2) ?? "N/A"}
Break-even margin of safety: ${(params.breakEvenMarginOfSafetyPct * 100).toFixed(1)}%
Year 1 minimum cumulative cash: $${Math.round(params.year1MinCumulativeCash).toLocaleString()}

Return ONLY valid JSON:
{
  "narrative": "2–3 paragraphs: (1) base case summary, (2) downside risk assessment with specific numbers, (3) recommended actions if downside materializes${hasRisk ? " — reference the borrower's own named risk and their planned response" : ""}"
}`;

  try {
    const text = await callGeminiJSON(prompt);
    return safeParseField(text, "narrative", "Sensitivity analysis not available.");
  } catch (err) {
    console.error("[sbaPackageNarrative] generateSensitivityNarrative error:", err);
    return "Sensitivity analysis not available.";
  }
}

/**
 * God Tier Business Plan — Plan Thesis
 *
 * Generated BEFORE all other narrative sections. The thesis is a 2–3 sentence
 * statement that captures the core argument of the entire plan, grounded in
 * the borrower's specific growth mechanism, specific use of proceeds, and
 * specific credit capacity. Every other narrative section receives this thesis
 * as context so the plan is coherent from executive summary to SWOT to
 * sensitivity commentary.
 *
 * Returns null when generation fails — callers must tolerate null and omit
 * the thesis from downstream prompts rather than passing a fallback string.
 */
export async function generatePlanThesis(params: {
  dealName: string;
  story: BorrowerStory | null;
  loanAmount: number;
  dscrYear1: number;
  projectedRevenueYear1: number;
  projectedRevenueYear3?: number;
  industryDescription: string;
  useOfProceedsDescription: string;
  managementLeadNames?: string[];
  yearsInBusiness?: number;
}): Promise<string | null> {
  const storyBlock = formatStoryForPrompt(params.story);
  const dscrPasses = params.dscrYear1 >= 1.25;

  const prompt = `You are the world's greatest business plan writer. Before drafting any section of the plan, you write a single THESIS — 2 to 3 sentences that express the core argument of the entire plan in plain language. Every later section will be written to support this thesis.

${STANDARD_GUARDRAILS}

REQUIREMENTS FOR THE THESIS:
- Must name the business (${params.dealName}) and the loan amount ($${params.loanAmount.toLocaleString()}).
- Must state the specific growth mechanism (how revenue grows — not "through marketing" but a named channel, partnership, customer type, or expansion step).
- Must state what the loan specifically enables (the concrete thing that gets better, eliminated, built, or unlocked).
- Must reference the Year 1 DSCR as a coverage/cushion claim (${params.dscrYear1.toFixed(2)}x, SBA min 1.25x — ${dscrPasses ? "cushion above the minimum" : "gap below the minimum"}).
- Third person. No superlatives. No "will be the leading" or "positioned as the premier". No invented statistics.
- 2 to 3 sentences total. Do not exceed 3.

${storyBlock || "(No borrower story available — derive the growth mechanism from the use of proceeds and industry description.)\n"}

Borrower: ${params.dealName}
Industry: ${params.industryDescription}
Years in business: ${params.yearsInBusiness ?? "Not specified"}
Loan amount: $${params.loanAmount.toLocaleString()}
Use of proceeds: ${params.useOfProceedsDescription}
Projected Year 1 revenue: $${Math.round(params.projectedRevenueYear1).toLocaleString()}
${params.projectedRevenueYear3 != null ? `Projected Year 3 revenue: $${Math.round(params.projectedRevenueYear3).toLocaleString()}` : ""}
Year 1 DSCR: ${params.dscrYear1.toFixed(2)}x
Management leads: ${(params.managementLeadNames ?? []).join(", ") || "Not specified"}

EXAMPLE (style only — do not copy facts):
"Samaritus Management is positioned to grow from $1.36M to $1.72M in revenue over three years by adding 2–3 management contracts annually through broker referral partnerships. The $500K loan eliminates the company's largest cost vulnerability — maintenance equipment — while the management team's 15 years of operational experience provide the depth to execute. With a projected Year 1 DSCR of 1.87x, the business carries meaningful cushion above the SBA 1.25x minimum."

Return ONLY valid JSON:
{ "thesis": "..." }`;

  try {
    const text = await callGeminiJSON(prompt);
    const thesis = safeParseField(text, "thesis", "");
    if (!thesis || thesis.trim().length < 40) return null;
    return thesis.trim();
  } catch (err) {
    console.error("[sbaPackageNarrative] generatePlanThesis error:", err);
    return null;
  }
}
