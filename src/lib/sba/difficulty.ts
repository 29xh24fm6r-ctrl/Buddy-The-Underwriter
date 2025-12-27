/**
 * SBA Difficulty Index
 * 
 * Gamified scoring system that shows borrowers their SBA readiness:
 * "You're 87% SBA-ready. Two small fixes unlock approval."
 * 
 * Makes the process feel achievable instead of intimidating.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { evaluateSBAEligibility, type EligibilityReport } from "./eligibility";

export type DifficultyScore = {
  deal_id: string;
  difficulty_score: number; // 0-100 (higher = better)
  readiness_percentage: number; // User-facing % (0-100)
  
  // Component scores
  eligibility_score: number;
  financial_score: number;
  collateral_score: number;
  documentation_score: number;
  
  // Blockers
  hard_stops: number;
  mitigable_issues: number;
  advisory_items: number;
  
  // Actionable guidance
  top_fixes: Array<{
    priority: number;
    fix: string;
    impact: string; // e.g., "+15% readiness"
  }>;
  estimated_time_to_ready: string; // "2 days", "1 week", etc.
  
  calculated_at: Date;
};

/**
 * Calculate SBA difficulty/readiness score
 */
export async function calculateDifficultyScore({
  dealId,
  program = "7A",
  dealData,
}: {
  dealId: string;
  program?: "7A" | "504";
  dealData: Record<string, any>;
}): Promise<DifficultyScore> {
  const sb = supabaseAdmin();

  // 1. Run eligibility evaluation
  const eligibilityReport = await evaluateSBAEligibility({
    dealId,
    program,
    dealData,
  });

  // 2. Calculate component scores
  const eligibility_score = calculateEligibilityScore(eligibilityReport);
  const financial_score = calculateFinancialScore(dealData);
  const collateral_score = calculateCollateralScore(dealData);
  const documentation_score = calculateDocumentationScore(dealData);

  // 3. Calculate overall difficulty score (weighted average)
  const difficulty_score = Math.round(
    eligibility_score * 0.4 +
    financial_score * 0.3 +
    collateral_score * 0.2 +
    documentation_score * 0.1
  );

  // 4. Calculate readiness percentage (nonlinear scaling for UX)
  const readiness_percentage = calculateReadinessPercentage(difficulty_score);

  // 5. Extract blockers
  const hard_stops = eligibilityReport.hard_stops.length;
  const mitigable_issues = eligibilityReport.mitigations_required.length;
  const advisory_items = eligibilityReport.advisories.length;

  // 6. Generate top fixes
  const top_fixes = generateTopFixes(eligibilityReport, dealData);

  // 7. Estimate time to ready
  const estimated_time_to_ready = estimateTimeToReady(hard_stops, mitigable_issues);

  // 8. Store score
  const score: DifficultyScore = {
    deal_id: dealId,
    difficulty_score,
    readiness_percentage,
    eligibility_score,
    financial_score,
    collateral_score,
    documentation_score,
    hard_stops,
    mitigable_issues,
    advisory_items,
    top_fixes,
    estimated_time_to_ready,
    calculated_at: new Date(),
  };

  await sb.from("deal_sba_difficulty_scores").insert({
    deal_id: dealId,
    difficulty_score,
    eligibility_score,
    financial_score,
    collateral_score,
    documentation_score,
    hard_stops,
    mitigable_issues,
    advisory_items,
    top_fixes,
    estimated_time_to_ready,
  });

  return score;
}

/**
 * Calculate eligibility component score
 */
function calculateEligibilityScore(report: EligibilityReport): number {
  const totalRules =
    report.hard_stops.length +
    report.mitigations_required.length +
    report.advisories.length +
    report.passed_rules.length;

  if (totalRules === 0) return 100;

  // Weighted deductions
  const hardStopPenalty = report.hard_stops.length * 30; // -30 per hard stop
  const mitigationPenalty = report.mitigations_required.length * 10; // -10 per mitigation
  const advisoryPenalty = report.advisories.length * 5; // -5 per advisory

  const score = 100 - hardStopPenalty - mitigationPenalty - advisoryPenalty;
  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate financial strength score
 */
function calculateFinancialScore(data: Record<string, any>): number {
  let score = 50; // Base score

  // DSCR (Debt Service Coverage Ratio)
  const dscr = data.dscr ?? 0;
  if (dscr >= 1.25) score += 25;
  else if (dscr >= 1.15) score += 15;
  else if (dscr >= 1.0) score += 5;
  else score -= 20; // Below 1.0 is bad

  // Business age
  const businessAge = data.business_age_years ?? 0;
  if (businessAge >= 3) score += 15;
  else if (businessAge >= 2) score += 10;
  else score -= 10;

  // Profitability trend
  const profitTrend = data.profit_trend ?? "stable";
  if (profitTrend === "improving") score += 10;
  else if (profitTrend === "declining") score -= 15;

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate collateral strength score
 */
function calculateCollateralScore(data: Record<string, any>): number {
  let score = 50;

  const ltv = data.ltv ?? 0; // Loan-to-value
  if (ltv <= 70) score += 30;
  else if (ltv <= 80) score += 20;
  else if (ltv <= 85) score += 10;
  else score -= 10;

  const hasRealEstate = data.has_real_estate_collateral ?? false;
  if (hasRealEstate) score += 20;

  return Math.max(0, Math.min(100, score));
}

/**
 * Calculate documentation completeness score
 */
function calculateDocumentationScore(data: Record<string, any>): number {
  const requiredDocs = [
    "tax_returns_3yr",
    "financial_statements",
    "business_plan",
    "personal_financial_statement",
    "ownership_docs",
  ];

  const uploadedDocs = data.uploaded_docs ?? [];
  const completeness = uploadedDocs.length / requiredDocs.length;

  return Math.round(completeness * 100);
}

/**
 * Calculate user-facing readiness percentage (nonlinear for UX)
 */
function calculateReadinessPercentage(difficultyScore: number): number {
  // Transform difficulty score to feel more achievable
  // 80+ → 100% (eligible)
  // 60-79 → 70-99% (close)
  // 40-59 → 40-69% (needs work)
  // <40 → <40% (major issues)

  if (difficultyScore >= 80) return 100;
  if (difficultyScore >= 60) {
    // Scale 60-79 to 70-99
    return Math.round(70 + ((difficultyScore - 60) / 20) * 29);
  }
  // Below 60, scale linearly
  return Math.round((difficultyScore / 60) * 70);
}

/**
 * Generate top priority fixes
 */
function generateTopFixes(
  report: EligibilityReport,
  data: Record<string, any>
): Array<{ priority: number; fix: string; impact: string }> {
  const fixes: Array<{ priority: number; fix: string; impact: string }> = [];

  // Priority 1: Hard stops
  report.hard_stops.forEach((r, i) => {
    if (r.suggested_fixes && r.suggested_fixes.length > 0) {
      fixes.push({
        priority: 1,
        fix: r.suggested_fixes[0].fix,
        impact: "+30% readiness",
      });
    }
  });

  // Priority 2: Mitigations
  report.mitigations_required.slice(0, 3).forEach((r) => {
    if (r.suggested_fixes && r.suggested_fixes.length > 0) {
      fixes.push({
        priority: 2,
        fix: r.suggested_fixes[0].fix,
        impact: "+10% readiness",
      });
    }
  });

  // Priority 3: Financial improvements
  const dscr = data.dscr ?? 0;
  if (dscr < 1.25) {
    fixes.push({
      priority: 3,
      fix: `Improve DSCR from ${dscr.toFixed(2)} to 1.25 (reduce debt or increase income)`,
      impact: "+15% readiness",
    });
  }

  return fixes.slice(0, 5); // Top 5 fixes
}

/**
 * Estimate time to achieve SBA readiness
 */
function estimateTimeToReady(hardStops: number, mitigableIssues: number): string {
  if (hardStops === 0 && mitigableIssues === 0) return "Ready now";
  if (hardStops === 0 && mitigableIssues <= 2) return "2-3 days";
  if (hardStops <= 1 && mitigableIssues <= 3) return "1 week";
  if (hardStops <= 2) return "2-3 weeks";
  return "1-2 months";
}

/**
 * Format difficulty score for display
 */
export function formatDifficultyScore(score: DifficultyScore): string {
  let output = `**SBA Readiness: ${score.readiness_percentage}%**\n\n`;

  if (score.hard_stops === 0) {
    output += `🎉 You're SBA-ready! No hard stops detected.\n\n`;
  } else {
    output += `You're ${score.readiness_percentage}% ready. ${score.hard_stops} item(s) to fix.\n\n`;
  }

  output += `**Estimated Time:** ${score.estimated_time_to_ready}\n\n`;

  if (score.top_fixes.length > 0) {
    output += `**Top Fixes:**\n`;
    score.top_fixes.forEach((fix, i) => {
      output += `${i + 1}. ${fix.fix} (${fix.impact})\n`;
    });
    output += `\n`;
  }

  output += `**Score Breakdown:**\n`;
  output += `- Eligibility: ${score.eligibility_score}/100\n`;
  output += `- Financials: ${score.financial_score}/100\n`;
  output += `- Collateral: ${score.collateral_score}/100\n`;
  output += `- Documentation: ${score.documentation_score}/100\n`;

  return output;
}
