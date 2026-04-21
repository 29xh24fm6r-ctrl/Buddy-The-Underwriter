import "server-only";

// src/lib/feasibility/feasibilityNarrative.ts
// Phase God Tier Feasibility — Narrative Generator (step 9/16).
// Turns deterministic scores + BIE research into consultant-quality prose
// via Gemini Pro. Does NOT compute scores. Parallel Promise.allSettled so
// a single Gemini failure never blocks the whole narrative — each section
// falls back to a humane "not available" placeholder.

import { callGeminiJSON } from "@/lib/sba/sbaPackageNarrative";
import type { ExtractedResearch } from "@/lib/sba/sbaResearchExtractor";
import type {
  ComparativeAnalysisResult,
  CompositeFeasibilityScore,
  FeasibilityNarratives,
  FinancialViabilityScore,
  LocationSuitabilityScore,
  ManagementMemberLite,
  MarketDemandScore,
  OperationalReadinessScore,
} from "./types";

export interface FeasibilityNarrativeInput {
  dealName: string;
  city: string | null;
  state: string | null;
  composite: CompositeFeasibilityScore;
  marketDemand: MarketDemandScore;
  financialViability: FinancialViabilityScore;
  operationalReadiness: OperationalReadinessScore;
  locationSuitability: LocationSuitabilityScore;
  franchiseComparison: ComparativeAnalysisResult | null;
  research: ExtractedResearch;
  isFranchise: boolean;
  brandName: string | null;
  managementTeam: ManagementMemberLite[];
}

export async function generateFeasibilityNarratives(
  params: FeasibilityNarrativeInput,
): Promise<FeasibilityNarratives> {
  const locationStr = params.city
    ? `${params.city}${params.state ? `, ${params.state}` : ""}`
    : "Not specified";

  const [
    execResult,
    marketResult,
    financialResult,
    opsResult,
    locationResult,
    riskResult,
    recoResult,
    franchiseResult,
  ] = await Promise.allSettled([
    // ── Executive Summary ────────────────────────────────────────
    callGeminiJSON(`You are a senior feasibility consultant writing the executive summary of a feasibility study.

Borrower: ${params.dealName}
Location: ${locationStr}
${params.isFranchise && params.brandName ? `Franchise: ${params.brandName}` : ""}

COMPOSITE FEASIBILITY SCORE: ${params.composite.overallScore}/100
RECOMMENDATION: ${params.composite.recommendation}
CONFIDENCE: ${params.composite.confidenceLevel}

Dimension Scores:
- Market Demand: ${params.composite.marketDemand.score}/100
- Financial Viability: ${params.composite.financialViability.score}/100
- Operational Readiness: ${params.composite.operationalReadiness.score}/100
- Location Suitability: ${params.composite.locationSuitability.score}/100

Critical Flags: ${params.composite.criticalFlags}
Warning Flags: ${params.composite.warningFlags}

Write a 400-500 word executive summary that:
1. Opens with the borrower name, location, and proposed business concept
2. States the overall feasibility score and recommendation clearly in the second paragraph
3. Summarizes the strongest dimension and the weakest dimension
4. Lists any critical flags that must be addressed
5. Closes with the specific conditions under which this venture is recommended (or not)

RULES:
- Be honest. If the score is low, say so and explain why.
- Use specific numbers from the scores. "Market demand scored 72/100" not "market demand appears adequate."
- Name management team members when discussing operational readiness.
- This is a judgment document, not a sales pitch.
- Third person, professional tone.

Return ONLY valid JSON: { "executiveSummary": "..." }`),

    // ── Market Demand ────────────────────────────────────────────
    callGeminiJSON(`You are writing the Market Demand section of a feasibility study.

Borrower: ${params.dealName}
Location: ${locationStr}
Score: ${params.marketDemand.overallScore}/100

Dimension Details:
- Population Adequacy: ${params.marketDemand.populationAdequacy.score}/100 — ${params.marketDemand.populationAdequacy.detail}
- Income Alignment: ${params.marketDemand.incomeAlignment.score}/100 — ${params.marketDemand.incomeAlignment.detail}
- Competitive Density: ${params.marketDemand.competitiveDensity.score}/100 — ${params.marketDemand.competitiveDensity.detail}
- Demand Trend: ${params.marketDemand.demandTrend.score}/100 — ${params.marketDemand.demandTrend.detail}

Flags: ${JSON.stringify(params.marketDemand.flags)}

BIE Research Context:
${params.research.marketIntelligence ? `Market Intelligence: ${params.research.marketIntelligence.slice(0, 2000)}` : "No market intelligence available."}
${params.research.competitiveLandscape ? `Competitive Landscape: ${params.research.competitiveLandscape.slice(0, 2000)}` : ""}

Write 600-800 words covering:
1. Trade area demographics and population adequacy
2. Income alignment with the business concept
3. Competitive landscape — who exists, how saturated is the market
4. Demand trajectory — is this market growing or shrinking
5. Specific opportunities or threats identified

RULES:
- Ground every claim in the score data or research. No invented statistics.
- If data was unavailable for a dimension, state that honestly.
- Use the exact numbers from the dimension details.

Return ONLY valid JSON: { "marketDemandNarrative": "..." }`),

    // ── Financial Viability ──────────────────────────────────────
    callGeminiJSON(`You are writing the Financial Viability section of a feasibility study.

Score: ${params.financialViability.overallScore}/100

Dimensions:
- DSCR Coverage: ${params.financialViability.debtServiceCoverage.score}/100 — ${params.financialViability.debtServiceCoverage.detail}
- Break-Even Margin: ${params.financialViability.breakEvenMargin.score}/100 — ${params.financialViability.breakEvenMargin.detail}
- Capitalization: ${params.financialViability.capitalizationAdequacy.score}/100 — ${params.financialViability.capitalizationAdequacy.detail}
- Cash Runway: ${params.financialViability.cashRunway.score}/100 — ${params.financialViability.cashRunway.detail}
- Downside Resilience: ${params.financialViability.downsideResilience.score}/100 — ${params.financialViability.downsideResilience.detail}

Flags: ${JSON.stringify(params.financialViability.flags)}

Write 600-800 words. Use exact DSCR numbers, break-even amounts, and margin of safety percentages.

Return ONLY valid JSON: { "financialViabilityNarrative": "..." }`),

    // ── Operational Readiness ────────────────────────────────────
    callGeminiJSON(`You are writing the Operational Readiness section of a feasibility study.

Score: ${params.operationalReadiness.overallScore}/100

Dimensions:
- Management Experience: ${params.operationalReadiness.managementExperience.score}/100 — ${params.operationalReadiness.managementExperience.detail}
- Industry Knowledge: ${params.operationalReadiness.industryKnowledge.score}/100 — ${params.operationalReadiness.industryKnowledge.detail}
- Staffing Readiness: ${params.operationalReadiness.staffingReadiness.score}/100 — ${params.operationalReadiness.staffingReadiness.detail}
${params.isFranchise ? `- Franchise Support: ${params.operationalReadiness.franchiseSupport.score}/100 — ${params.operationalReadiness.franchiseSupport.detail}` : ""}

Management Team:
${params.managementTeam
  .map(
    (m) =>
      `${m.name} (${m.title}, ${m.yearsInIndustry} years): ${m.bio || "bio not provided"}`,
  )
  .join("\n")}

Write 400-600 words. Name each team member. Be honest about experience gaps.

Return ONLY valid JSON: { "operationalReadinessNarrative": "..." }`),

    // ── Location Suitability ─────────────────────────────────────
    callGeminiJSON(`You are writing the Location Suitability section of a feasibility study.

Score: ${params.locationSuitability.overallScore}/100

Dimensions:
- Economic Health: ${params.locationSuitability.economicHealth.score}/100 — ${params.locationSuitability.economicHealth.detail}
- Real Estate: ${params.locationSuitability.realEstateMarket.score}/100 — ${params.locationSuitability.realEstateMarket.detail}
- Access & Visibility: ${params.locationSuitability.accessAndVisibility.score}/100 — ${params.locationSuitability.accessAndVisibility.detail}
- Risk Exposure: ${params.locationSuitability.riskExposure.score}/100 — ${params.locationSuitability.riskExposure.detail}

BIE Market Intelligence: ${params.research.marketIntelligence?.slice(0, 1500) ?? "Not available"}

Write 400-600 words.

Return ONLY valid JSON: { "locationSuitabilityNarrative": "..." }`),

    // ── Risk Assessment ──────────────────────────────────────────
    callGeminiJSON(`You are writing the Risk Assessment section of a feasibility study.

All flags from the analysis:
${JSON.stringify(params.composite.allFlags, null, 2)}

Overall Score: ${params.composite.overallScore}/100
Recommendation: ${params.composite.recommendation}

For each critical and warning flag, write:
1. The risk identified
2. The potential impact on the business
3. A specific, actionable mitigation strategy

Write 400-600 words. Be specific. Generic mitigations like "seek professional advice" are not acceptable.

Return ONLY valid JSON: { "riskAssessment": "..." }`),

    // ── Recommendation ───────────────────────────────────────────
    callGeminiJSON(`You are writing the final Recommendation section of a feasibility study.

Borrower: ${params.dealName}
Location: ${locationStr}
Score: ${params.composite.overallScore}/100
Recommendation: ${params.composite.recommendation}
Confidence: ${params.composite.confidenceLevel}

Dimension scores:
- Market: ${params.composite.marketDemand.score}
- Financial: ${params.composite.financialViability.score}
- Operational: ${params.composite.operationalReadiness.score}
- Location: ${params.composite.locationSuitability.score}

Critical flags: ${params.composite.criticalFlags}
Dimensions missing data: ${params.composite.dimensionsMissingData.join(", ") || "None"}

Write 300-400 words. State the recommendation clearly in the first sentence. Then explain the conditions:
- If "Recommended" or "Strongly Recommended": what must the borrower execute on to succeed
- If "Conditionally Feasible": what specific changes or additional data would upgrade this to Recommended
- If "Significant Concerns" or "Not Recommended": what fundamental issues must be resolved, and whether pivot is possible

End with a clear, one-sentence verdict.

Return ONLY valid JSON: { "recommendation": "..." }`),

    // ── Franchise Comparison (optional) ──────────────────────────
    params.franchiseComparison
      ? callGeminiJSON(`You are writing the Franchise Comparison section of a feasibility study.

Proposed brand: ${params.brandName ?? "(not specified)"}
Proposed rank: ${params.franchiseComparison.proposedRank}
Better alternative exists: ${params.franchiseComparison.betterAlternativeExists ? "yes" : "no"}

Alternatives analyzed:
${params.franchiseComparison.alternatives
  .map(
    (b) =>
      `- ${b.brandName}: feasibility ${b.feasibilityScore}/100${b.systemAverageRevenue ? `, system avg revenue $${b.systemAverageRevenue.toLocaleString()}` : ""}. Match reasons: ${b.matchReasons.join("; ")}. Risks: ${b.riskFactors.join("; ")}`,
  )
  .join("\n") || "(none)"}

Write 400-600 words. Honestly compare the proposed brand against alternatives that fit the borrower's profile. If a better alternative exists, name it and explain why.

Return ONLY valid JSON: { "franchiseComparisonNarrative": "..." }`)
      : Promise.resolve<string | null>(null),
  ]);

  return {
    executiveSummary: extractNarrativeResult(execResult, "executiveSummary"),
    marketDemandNarrative: extractNarrativeResult(
      marketResult,
      "marketDemandNarrative",
    ),
    financialViabilityNarrative: extractNarrativeResult(
      financialResult,
      "financialViabilityNarrative",
    ),
    operationalReadinessNarrative: extractNarrativeResult(
      opsResult,
      "operationalReadinessNarrative",
    ),
    locationSuitabilityNarrative: extractNarrativeResult(
      locationResult,
      "locationSuitabilityNarrative",
    ),
    riskAssessment: extractNarrativeResult(riskResult, "riskAssessment"),
    recommendation: extractNarrativeResult(recoResult, "recommendation"),
    franchiseComparisonNarrative:
      franchiseResult.status === "fulfilled" && franchiseResult.value
        ? extractNarrativeResult(franchiseResult, "franchiseComparisonNarrative")
        : null,
  };
}

// ── Helper: pull the named field out of Gemini's JSON response ──────────

function extractNarrativeResult(
  result: PromiseSettledResult<string | null>,
  key: string,
): string {
  if (result.status !== "fulfilled" || !result.value) {
    return `${key} not available.`;
  }
  let text = result.value.trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/```\s*$/, "");
  }
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    const val = parsed[key];
    return typeof val === "string" && val.length > 0
      ? val
      : `${key} generation failed.`;
  } catch {
    // If the model returned plain prose instead of JSON, use it as-is.
    return text.length > 50 ? text : `${key} generation failed.`;
  }
}
