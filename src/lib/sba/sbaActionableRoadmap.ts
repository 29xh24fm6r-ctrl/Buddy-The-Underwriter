import "server-only";

// src/lib/sba/sbaActionableRoadmap.ts
// Phase 85-BPG-EXPERIENCE — "What this means for you" roadmap narrative.
// Single-purpose Gemini call that turns projection outputs into a plain-English
// set of milestones the borrower can actually use. Falls back to a deterministic
// summary if the model call fails or GEMINI_API_KEY is unavailable.
//
// SPEC-M1.1 — migrated onto the AI gateway (generator role, modelOverride
// preserves the deliberate GEMINI_PRO upgrade over the role's default
// GEMINI_FLASH — "Pro for deal-specific prose", per MODEL_SBA_NARRATIVE's
// own comment in models.ts).

import { forecastCoverage } from "./forecastCoverage";
import { auditProjectionNarrative } from "@/lib/ai/projectionNarrativeAudit";
import { runRole } from "@/lib/ai/gateway";

export interface RoadmapInput {
  businessName: string;
  loanAmount: number;
  revenue: number;
  breakEvenRevenue: number;
  marginOfSafetyPct: number;
  dscrYear1: number;
  dscrYear2: number | null;
  dscrYear3: number | null;
  downsideCoverage: [number | null, number | null, number | null];
  monthlyDebtService: number;
  grossMarginPct: number;
  cogsPercent: number;
  revenueGrowthY1: number;
  /** Deal-specific coverage floor supplied by the authoritative model. */
  dscrThreshold: number;
}

function coverageEvidence(input: RoadmapInput) {
  const threshold = input.dscrThreshold;
  const base = forecastCoverage([input.dscrYear1, input.dscrYear2, input.dscrYear3], threshold);
  const downside = forecastCoverage(input.downsideCoverage, threshold);
  const risk = downside.belowDebtService.length
    ? `The saved downside scenario cannot cover debt service in ${downside.shortfalls}.`
    : downside.belowThreshold.length
      ? `The saved downside scenario falls below the model's ${threshold.toFixed(2)}x threshold in ${downside.failures}.`
      : downside.complete
        ? `The saved downside scenario meets the model's ${threshold.toFixed(2)}x threshold in all three years, subject to the assumptions.`
        : "Downside repayment coverage is not established across all three years.";
  return { threshold, base, downside, text: `Base-case coverage: ${base.path}. Downside coverage: ${downside.path}. ${risk}` };
}

export async function generateActionableRoadmap(
  input: RoadmapInput,
): Promise<string> {
  let model: string;
  try {
    const mod = await import("@/lib/ai/models");
    model = mod.MODEL_SBA_NARRATIVE;
  } catch {
    return buildFallbackRoadmap(input);
  }

  const evidence = coverageEvidence(input);
  const monthlyRevTarget = Math.round(input.revenue / 12);
  const monthlyBreakEven = Math.round(input.breakEvenRevenue / 12);

  const prompt = `You are the world's leading business projections consultant. You've just completed a comprehensive financial projection for ${input.businessName}. Now deliver your expert guidance — what should the owner focus on to succeed?

PROJECTION DATA:
- Projected Year 1 revenue: $${input.revenue.toLocaleString()}
- Monthly revenue target: $${monthlyRevTarget.toLocaleString()}
- Monthly break-even: $${monthlyBreakEven.toLocaleString()} (${(input.marginOfSafetyPct * 100).toFixed(0)}% safety cushion)
- Loan amount: $${input.loanAmount.toLocaleString()}
- Monthly loan payment: $${Math.round(input.monthlyDebtService).toLocaleString()}
- Gross margin: ${(input.grossMarginPct * 100).toFixed(1)}%
- Cost of goods: ${(input.cogsPercent * 100).toFixed(0)}% of revenue
- Model coverage threshold: ${evidence.threshold.toFixed(2)}x
- ${evidence.text}
- Revenue growth assumption: ${(input.revenueGrowthY1 * 100).toFixed(0)}% Year 1

Write a 3-4 paragraph roadmap in second person ("you", "your"). Include:

1. WHAT THE NUMBERS MEAN: Translate the financials into plain English. "You need to generate $X per month to cover all costs including your loan payment. You're projecting $Y, which gives you $Z of cushion."

2. THREE KEY MILESTONES: Specific, measurable targets for Year 1. Example: "Hit $X monthly revenue by Month 3" or "Keep food cost below X%" — tied to their actual numbers.

3. RISK AWARENESS: One paragraph about what could go wrong and how to prepare. Use the downside scenario data. Be honest but not alarming.

4. CLOSING ASSESSMENT: State the conditional outlook and any unresolved repayment shortfall. Never infer full-horizon resilience from Year 1 alone.

RULES:
- Use actual dollar amounts, not percentages where possible
- Sound like a trusted advisor, not a textbook
- No banking jargon (no "DSCR", no "debt service coverage ratio")
- No bullet points — flowing paragraphs
- Explain coverage ratios in plain English and retain the three-year downside values and any shortfall.
- Do not describe the saved downside as a one-time 15% revenue drop; the scenario compounds its growth assumptions across years.
- Do not claim proposed mitigations restore coverage unless a saved scenario demonstrates that result.
- Maximum 400 words

Return ONLY the roadmap text. No JSON. No markdown headers.`;

  try {
    const result = await runRole("generator", {
      modelOverride: model,
      purpose: "sba_actionable_roadmap",
      maxOutputTokens: 1024,
      prompt,
    });

    const trimmed = result.text.trim();
    const issues = auditProjectionNarrative({ sensitivityScenarios: [{
      name: "downside", dscrYear1: input.downsideCoverage[0], dscrYear2: input.downsideCoverage[1], dscrYear3: input.downsideCoverage[2],
      passesSBAThreshold: evidence.downside.complete && evidence.downside.belowThreshold.length === 0,
    }] }, [{ key: "risk_roadmap", text: trimmed }]);
    return trimmed && evidence.base.complete && evidence.downside.complete && !issues.length ? trimmed : buildFallbackRoadmap(input);
  } catch {
    return buildFallbackRoadmap(input);
  }
}

function buildFallbackRoadmap(input: RoadmapInput): string {
  const monthlyRev = Math.round(input.revenue / 12);
  const monthlyBE = Math.round(input.breakEvenRevenue / 12);
  const cushion = monthlyRev - monthlyBE;
  const reserveGoal = Math.round(input.monthlyDebtService * 2);
  const earlyTarget = Math.round(monthlyRev * 0.8);
  const safetyPct = Math.round(input.marginOfSafetyPct * 100);
  const evidence = coverageEvidence(input);

  return [
    `Your business is projected to generate $${monthlyRev.toLocaleString()} per month in Year 1. ` +
      `Your break-even point — the revenue you need just to cover all costs, including your monthly loan payment of $${Math.round(input.monthlyDebtService).toLocaleString()} — is $${monthlyBE.toLocaleString()} per month. ` +
      `That leaves you with $${cushion.toLocaleString()} of monthly cushion, a safety margin of about ${safetyPct}%.`,
    ``,
    `Focus on three targets for your first year. First, keep your cost of goods at or below ${(input.cogsPercent * 100).toFixed(0)}% of revenue — that's what holds your gross margin at ${(input.grossMarginPct * 100).toFixed(0)}%. ` +
      `Second, reach roughly $${earlyTarget.toLocaleString()} in monthly revenue by Month 3 so you're trending toward your annual goal. ` +
      `Third, build a cash reserve equal to at least two months of loan payments — around $${reserveGoal.toLocaleString()} — so you have runway if any one month is slow.`,
    ``,
    `${evidence.text} Monitor actual revenue and costs, build reserves, and review the plan if performance falls short. Proposed cost reductions do not establish restored coverage until they are modeled.`,
    ``,
    `These projections depend on the saved assumptions. ${!evidence.base.complete || !evidence.downside.complete
      ? "Complete the missing forecast evidence before assessing repayment resilience."
      : evidence.base.belowThreshold.length || evidence.downside.belowThreshold.length
        ? "Resolve the projected coverage shortfalls before relying on this plan for repayment."
        : "All modeled years meet the coverage threshold; actual results and lender review remain necessary."}`,
  ].join("\n");
}
