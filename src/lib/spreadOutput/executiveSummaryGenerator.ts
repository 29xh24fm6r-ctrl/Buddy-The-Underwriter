/**
 * Executive Summary Generator — Panel 1
 *
 * Generates the executive summary from SpreadOutputInput and composed narratives.
 * Pure function — no DB, no server imports.
 */

import type { SpreadOutputInput, ExecutiveSummary, RecommendationLevel } from "./types";
import type { ComposedNarratives } from "./narrativeComposer";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function generateExecutiveSummary(
  input: SpreadOutputInput,
  narratives: ComposedNarratives,
): ExecutiveSummary {
  return {
    business_overview: buildBusinessOverview(input),
    financial_snapshot: buildFinancialSnapshot(input, narratives),
    coverage_summary: buildCoverageSummary(input, narratives),
    collateral_summary: buildCollateralSummary(input),
    risk_flags_summary: buildRiskFlagsSummary(input),
    recommendation_language: buildRecommendationLanguage(input),
    recommendation_level: computeRecommendationLevel(input),
  };
}

// ---------------------------------------------------------------------------
// Business overview
// ---------------------------------------------------------------------------

function buildBusinessOverview(input: SpreadOutputInput): string {
  const entityName = str(input.canonical_facts["entity_name"]) || str(input.canonical_facts["borrower_name"]) || "The borrower";
  const entityType = str(input.canonical_facts["entity_type"]) || "business";
  const naicsDesc = str(input.canonical_facts["naics_description"]) || str(input.canonical_facts["naics_code"]) || "commercial entity";
  const yearsInBusiness = num(input.canonical_facts["years_in_business"]);

  const revenue = num(input.canonical_facts["TOTAL_REVENUE"])
    ?? num(input.canonical_facts["is_gross_revenue"])
    ?? num(input.canonical_facts["GROSS_RECEIPTS"]);

  const loanPurpose = str(input.canonical_facts["loan_purpose"]) || "proposed financing";
  const loanAmount = num(input.canonical_facts["loan_amount"]);

  const parts: string[] = [];

  // Sentence 1: entity description
  const yearsPhrase = yearsInBusiness !== null ? ` with ${Math.round(yearsInBusiness)} years of operating history` : "";
  parts.push(`${entityName} is a ${entityType} ${naicsDesc}${yearsPhrase}.`);

  // Sentence 2: revenue
  if (revenue !== null) {
    const trendPhrase = buildRevenueTrendPhrase(input);
    parts.push(`The company generates approximately ${fmtDollars(revenue)} in annual revenue${trendPhrase}.`);
  }

  // Sentence 3: loan
  if (loanAmount !== null) {
    parts.push(`The proposed ${loanPurpose} totals ${fmtDollars(loanAmount)}.`);
  }

  return parts.join(" ");
}

function buildRevenueTrendPhrase(input: SpreadOutputInput): string {
  const trend = input.trend_report?.trendRevenue?.direction;
  if (!trend) return "";
  if (trend === "POSITIVE") return ", with a positive growth trajectory";
  if (trend === "DECLINING") return ", on a declining trajectory";
  return "";
}

// ---------------------------------------------------------------------------
// Financial snapshot
// ---------------------------------------------------------------------------

function buildFinancialSnapshot(input: SpreadOutputInput, narratives: ComposedNarratives): string {
  const parts: string[] = [];

  // Revenue trend
  const trendRevenue = input.trend_report?.trendRevenue;
  if (trendRevenue?.direction) {
    const revValues = trendRevenue.values.filter((v): v is number => v !== null);
    if (revValues.length >= 2) {
      const prior = revValues[0];
      const current = revValues[revValues.length - 1];
      const pctChange = prior > 0 ? ((current - prior) / prior * 100).toFixed(1) : "N/A";
      parts.push(`Revenue ${trendRevenue.direction === "POSITIVE" ? "grew" : trendRevenue.direction === "DECLINING" ? "declined" : "remained stable"} ${pctChange}% over ${revValues.length} years.`);
    }
  }

  // EBITDA margin
  const ebitdaMargin = getNum(input.ratios, "EBITDA_MARGIN", "ratio_ebitda_margin_pct");
  if (ebitdaMargin !== null) {
    parts.push(`EBITDA margin is ${(ebitdaMargin * 100).toFixed(1)}%.`);
  }

  // QoE mention
  if (narratives.ratio_narratives["QOE"]) {
    parts.push(narratives.ratio_narratives["QOE"]);
  }

  return parts.length > 0 ? parts.join(" ") : "Financial data is being analyzed.";
}

// ---------------------------------------------------------------------------
// Coverage summary
// ---------------------------------------------------------------------------

function buildCoverageSummary(input: SpreadOutputInput, narratives: ComposedNarratives): string {
  const dscrNarrative = narratives.ratio_narratives["DSCR"];
  if (dscrNarrative) {
    const globalQualifier = narratives.resolution_narrative
      ? ` ${narratives.resolution_narrative}`
      : "";
    return dscrNarrative + globalQualifier;
  }
  return "Debt service coverage has not yet been computed.";
}

// ---------------------------------------------------------------------------
// Collateral summary
// ---------------------------------------------------------------------------

function buildCollateralSummary(input: SpreadOutputInput): string {
  const isCRE = input.deal_type.startsWith("cre_");

  if (isCRE) {
    const appraised = num(input.canonical_facts["appraised_value"]);
    const ltv = getNum(input.ratios, "cre_ltv_pct", "LTV", "ratio_ltv");
    if (appraised !== null && ltv !== null) {
      return `The subject property has an appraised value of ${fmtDollars(appraised)}, resulting in ${(ltv * 100).toFixed(1)}% LTV.`;
    }
    if (appraised !== null) {
      return `The subject property has an appraised value of ${fmtDollars(appraised)}.`;
    }
    return "Appraisal information is pending.";
  }

  // C&I
  const guarantorName = str(input.canonical_facts["guarantor_name"]) || "the guarantor";
  const personalNW = num(input.canonical_facts["personal_net_worth"]);
  const personalLiq = num(input.canonical_facts["personal_liquidity"]) ?? num(input.canonical_facts["post_close_liquidity"]);

  const parts = ["Primary repayment source is business cash flow."];
  if (personalNW !== null) {
    parts.push(`Secondary repayment is personal guarantee of ${guarantorName} with personal net worth of ${fmtDollars(personalNW)}${personalLiq !== null ? ` and liquidity of ${fmtDollars(personalLiq)}` : ""}.`);
  }
  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Risk flags summary
// ---------------------------------------------------------------------------

function buildRiskFlagsSummary(input: SpreadOutputInput): string {
  if (!input.flag_report || input.flag_report.flags.length === 0) {
    return "No material risk flags were identified in the financial analysis.";
  }

  const activeFlags = input.flag_report.flags.filter(
    (f) => f.status !== "resolved" && f.status !== "waived",
  );

  if (activeFlags.length === 0) {
    return "All risk flags have been resolved or waived.";
  }

  const critical = activeFlags.filter((f) => f.severity === "critical");
  const elevated = activeFlags.filter((f) => f.severity === "elevated");

  const parts: string[] = [];
  if (critical.length > 0) {
    parts.push(`${critical.length} critical flag(s): ${critical.map((f) => f.banker_summary).join("; ")}`);
  }
  if (elevated.length > 0) {
    parts.push(`${elevated.length} elevated risk flag(s): ${elevated.map((f) => f.banker_summary).join("; ")}`);
  }
  if (parts.length === 0) {
    parts.push(`${activeFlags.length} active watch/informational flag(s).`);
  }

  return parts.join(". ") + ".";
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

function computeRecommendationLevel(input: SpreadOutputInput): RecommendationLevel {
  const dscr = getNum(input.ratios, "DSCR", "ratio_dscr_final");
  const criticalCount = input.flag_report?.critical_count ?? 0;
  const unresolvedCritical = (input.flag_report?.flags ?? []).filter(
    (f) => f.severity === "critical" && f.status !== "resolved" && f.status !== "waived",
  ).length;

  if (unresolvedCritical > 0) return "insufficient";
  if (dscr !== null && dscr < 1.10) return "insufficient";
  if (dscr !== null && dscr >= 1.50 && criticalCount === 0) return "strong";
  if (dscr !== null && dscr >= 1.25 && criticalCount === 0) return "adequate";
  if (dscr !== null && dscr >= 1.10) return "marginal";

  // No DSCR available — can't assess
  return "marginal";
}

function buildRecommendationLanguage(input: SpreadOutputInput): string {
  const level = computeRecommendationLevel(input);
  switch (level) {
    case "strong":
      return "The credit profile presents strong coverage with adequate margins of safety.";
    case "adequate":
      return "The credit profile presents adequate coverage with standard covenant protections.";
    case "marginal":
      return "The credit profile presents marginal coverage requiring enhanced monitoring.";
    case "insufficient":
      return "The credit profile presents insufficient coverage to support the proposed obligation.";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function str(val: unknown): string {
  if (typeof val === "string") return val;
  return "";
}

function num(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

function getNum(ratios: Record<string, number | null>, ...keys: string[]): number | null {
  for (const key of keys) {
    const val = ratios[key];
    if (val !== null && val !== undefined && isFinite(val)) return val;
  }
  return null;
}

function fmtDollars(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${Math.round(val / 1_000).toLocaleString("en-US")}K`;
  return `$${Math.round(val).toLocaleString("en-US")}`;
}
