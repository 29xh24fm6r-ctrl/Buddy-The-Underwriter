/**
 * Narrative Composer — deterministic composition engine
 *
 * Assembles pre-validated narrative blocks based on computed data.
 * NEVER invents facts, always sources from SpreadOutputInput.
 * NEVER outputs {curly_brace} placeholders — if a variable is missing,
 * substitutes "N/A" or a generic fallback.
 *
 * Pure function — no DB, no server imports.
 */

import type { SpreadOutputInput, StoryElement } from "./types";
import {
  COVERAGE_NARRATIVES,
  LEVERAGE_NARRATIVES,
  WORKING_CAPITAL_NARRATIVES,
  QOE_NARRATIVES,
  TREND_NARRATIVES,
  GLOBAL_NARRATIVES,
  STRENGTH_NARRATIVES,
} from "./narrativeTemplates";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export interface ComposedNarratives {
  ratio_narratives: Record<string, string>;
  top_risks: StoryElement[];
  top_strengths: StoryElement[];
  resolution_narrative: string;
  final_narrative: string;
}

export function composeNarratives(input: SpreadOutputInput): ComposedNarratives {
  const policy = input.bank_policy ?? {
    dscr_minimum: 1.25,
    fccr_minimum: 1.15,
    current_ratio_minimum: 1.10,
    ltv_maximum: 0.75,
    ltc_maximum: 0.80,
    debt_ebitda_maximum: 4.5,
    post_close_liquidity_pct: 0.10,
  };

  const ratioNarratives: Record<string, string> = {};

  // DSCR narrative
  const dscr = getNum(input.ratios, "DSCR", "ratio_dscr_final");
  const annualDebtService = getNum(input.ratios, "cf_annual_debt_service") ?? getFactNum(input.canonical_facts, "cf_annual_debt_service");
  const cushion = dscr !== null && annualDebtService !== null
    ? fmtDollars(Math.max(0, (dscr - 1.0) * annualDebtService))
    : "N/A";
  const stressPct = dscr !== null && dscr > 1.0
    ? Math.round(((dscr - 1.0) / dscr) * 100)
    : 0;

  if (dscr !== null) {
    let dscrNarrative: string;
    if (dscr >= 1.50) {
      dscrNarrative = sub(COVERAGE_NARRATIVES.dscr_strong.template, {
        dscr: fmtX(dscr), cushion, stress_pct: String(stressPct),
      });
    } else if (dscr >= 1.25) {
      dscrNarrative = sub(COVERAGE_NARRATIVES.dscr_adequate.template, {
        dscr: fmtX(dscr), cushion, stress_pct: String(stressPct),
        peer_median: "1.40", naics_description: getNaicsDesc(input),
      });
    } else if (dscr >= 1.10) {
      const covenantThreshold = Math.max(1.0, policy.dscr_minimum - 0.05);
      dscrNarrative = sub(COVERAGE_NARRATIVES.dscr_marginal.template, {
        dscr: fmtX(dscr), policy_min: fmtX(policy.dscr_minimum), cushion,
        covenant_threshold: fmtX(covenantThreshold), frequency: "annually",
      });
    } else {
      const globalDscr = getNum(input.ratios, "global_dscr", "ratio_dscr_global");
      const globalRes = globalDscr !== null && globalDscr >= policy.dscr_minimum
        ? `resolves the shortfall at ${fmtX(globalDscr)}x`
        : "does not resolve the shortfall";
      dscrNarrative = sub(COVERAGE_NARRATIVES.dscr_insufficient.template, {
        dscr: fmtX(dscr), global_resolution: globalRes,
      });
    }
    ratioNarratives["DSCR"] = dscrNarrative;
  }

  // Leverage narrative
  const debtEbitda = getNum(input.ratios, "DEBT_TO_EBITDA", "ratio_debt_ebitda");
  if (debtEbitda !== null && debtEbitda > policy.debt_ebitda_maximum) {
    const trendLeverage = input.trend_report?.trendLeverage;
    const direction = trendLeverage?.direction;
    const priorValues = trendLeverage?.values ?? [];
    const priorDE = priorValues.length >= 2 ? priorValues[priorValues.length - 2] : null;

    if (direction === "IMPROVING" && priorDE !== null) {
      ratioNarratives["DEBT_TO_EBITDA"] = sub(LEVERAGE_NARRATIVES.leverage_elevated_declining.template, {
        debt_ebitda: fmtX(debtEbitda), prior_debt_ebitda: fmtX(priorDE),
        target: fmtX(policy.debt_ebitda_maximum), years: "2-3",
      });
    } else if (direction === "WORSENING" && priorDE !== null) {
      ratioNarratives["DEBT_TO_EBITDA"] = sub(LEVERAGE_NARRATIVES.leverage_elevated_increasing.template, {
        prior_debt_ebitda: fmtX(priorDE), current_debt_ebitda: fmtX(debtEbitda),
        years: String(priorValues.length), warning_threshold: fmtX(policy.debt_ebitda_maximum + 2),
        projection_years: "2-3",
      });
    } else {
      ratioNarratives["DEBT_TO_EBITDA"] = sub(LEVERAGE_NARRATIVES.leverage_elevated_stable.template, {
        debt_ebitda: fmtX(debtEbitda), peer_median: "2.50",
        naics_description: getNaicsDesc(input), percentile: "N/A",
        years: String(Math.max(1, priorValues.length)),
      });
    }
  }

  // DSO narrative
  const dso = getNum(input.ratios, "DSO", "ratio_dso");
  if (dso !== null && dso > 60) {
    const trendDso = input.trend_report?.trendDso;
    const dsoDirection = trendDso?.direction;
    const dsoValues = trendDso?.values ?? [];
    const priorDso = dsoValues.length >= 2 ? dsoValues[dsoValues.length - 2] : null;
    const delta = priorDso !== null ? Math.round(dso - priorDso) : 0;

    if (dsoDirection === "DETERIORATING" && delta > 0) {
      ratioNarratives["DSO"] = sub(WORKING_CAPITAL_NARRATIVES.dso_deteriorating.template, {
        delta: String(delta), current_dso: String(Math.round(dso)),
        ar_impact: "N/A",
      });
    } else {
      ratioNarratives["DSO"] = sub(WORKING_CAPITAL_NARRATIVES.dso_elevated.template, {
        dso: String(Math.round(dso)), percentile: "N/A",
        naics_description: getNaicsDesc(input), peer_median: "38",
        ar_impact: "N/A",
      });
    }
  }

  // QoE narrative
  const qoeReport = input.qoe_report;
  if (qoeReport) {
    const reported = qoeReport.reportedEbitda;
    const adjusted = qoeReport.adjustedEbitda;
    const adjustmentTotal = qoeReport.adjustmentTotal;

    if (reported > 0 && Math.abs(adjustmentTotal / reported) > 0.05) {
      const overstmt = reported > 0 ? Math.round((Math.abs(adjustmentTotal) / adjusted) * 100) : 0;
      ratioNarratives["QOE"] = sub(QOE_NARRATIVES.qoe_material.template, {
        reported: fmtDollars(reported), adjustment: fmtDollars(Math.abs(adjustmentTotal)),
        description: "items", normalized: fmtDollars(adjusted),
        overstatement_pct: String(overstmt),
      });
    } else {
      ratioNarratives["QOE"] = sub(QOE_NARRATIVES.qoe_clean.template, {
        ebitda: fmtDollars(adjusted > 0 ? adjusted : reported),
      });
    }
  }

  // Trend narratives
  const trendReport = input.trend_report;
  if (trendReport) {
    // Revenue declining
    if (trendReport.trendRevenue.direction === "DECLINING") {
      const revValues = trendReport.trendRevenue.values.filter((v): v is number => v !== null);
      if (revValues.length >= 2) {
        const peak = Math.max(...revValues);
        const current = revValues[revValues.length - 1];
        const pctDecline = peak > 0 ? Math.round(((peak - current) / peak) * 100) : 0;
        ratioNarratives["TREND_REVENUE"] = sub(TREND_NARRATIVES.revenue_declining.template, {
          pct: String(pctDecline), years: String(revValues.length),
          peak: fmtDollars(peak), current: fmtDollars(current),
          context: "Management should address the decline drivers.",
          stress_pct: "10", stressed_dscr: dscr !== null ? fmtX(dscr * 0.90) : "N/A",
        });
      }
    }

    // Margin compressing
    if (trendReport.trendGrossMargin.direction === "COMPRESSING") {
      const marginValues = trendReport.trendGrossMargin.values.filter((v): v is number => v !== null);
      if (marginValues.length >= 2) {
        const prior = marginValues[0];
        const current = marginValues[marginValues.length - 1];
        const bps = Math.round((prior - current) * 10000);
        ratioNarratives["TREND_MARGIN"] = sub(TREND_NARRATIVES.margin_compressing.template, {
          prior_margin: fmtPct(prior), current_margin: fmtPct(current),
          years: String(marginValues.length), bps: String(bps),
          cause_hypothesis: "Cost pressures or pricing erosion may be contributing.",
          threshold: fmtX(policy.dscr_minimum), projection_months: "18-24",
        });
      }
    }
  }

  // --- Risks ---
  const topRisks = buildTopRisks(input, ratioNarratives);

  // --- Strengths ---
  const topStrengths = buildTopStrengths(input, qoeReport);

  // --- Resolution narrative ---
  const resolutionNarrative = buildResolutionNarrative(input, policy);

  // --- Final narrative ---
  const finalNarrative = buildFinalNarrative(input, dscr, topRisks, topStrengths, resolutionNarrative);

  return {
    ratio_narratives: ratioNarratives,
    top_risks: topRisks,
    top_strengths: topStrengths,
    resolution_narrative: resolutionNarrative,
    final_narrative: finalNarrative,
  };
}

// ---------------------------------------------------------------------------
// Risk identification — critical flags first, then elevated, then weak ratios
// ---------------------------------------------------------------------------

function buildTopRisks(input: SpreadOutputInput, narratives: Record<string, string>): StoryElement[] {
  const risks: StoryElement[] = [];

  // Critical flags first
  if (input.flag_report) {
    for (const flag of input.flag_report.flags) {
      if (flag.severity === "critical" && flag.status !== "resolved" && flag.status !== "waived") {
        risks.push({
          title: flag.banker_summary,
          narrative: flag.banker_detail,
          severity: "critical",
        });
      }
    }
    // Elevated flags next
    for (const flag of input.flag_report.flags) {
      if (flag.severity === "elevated" && flag.status !== "resolved" && flag.status !== "waived") {
        risks.push({
          title: flag.banker_summary,
          narrative: flag.banker_detail,
          severity: "elevated",
        });
      }
    }
  }

  // Weak/concerning ratio narratives
  const dscr = getNum(input.ratios, "DSCR", "ratio_dscr_final");
  if (dscr !== null && dscr < 1.25 && narratives["DSCR"]) {
    risks.push({
      title: `DSCR of ${fmtX(dscr)}x is below policy minimum`,
      narrative: narratives["DSCR"],
      severity: dscr < 1.0 ? "critical" : "elevated",
    });
  }

  if (narratives["DEBT_TO_EBITDA"]) {
    risks.push({
      title: "Elevated leverage",
      narrative: narratives["DEBT_TO_EBITDA"],
      severity: "elevated",
    });
  }

  if (narratives["TREND_REVENUE"]) {
    risks.push({
      title: "Declining revenue trend",
      narrative: narratives["TREND_REVENUE"],
      severity: "watch",
    });
  }

  return risks.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Strength identification — ratios above p75, clean QoE, liquidity
// ---------------------------------------------------------------------------

function buildTopStrengths(
  input: SpreadOutputInput,
  qoeReport: SpreadOutputInput["qoe_report"],
): StoryElement[] {
  const strengths: StoryElement[] = [];

  // Strong DSCR
  const dscr = getNum(input.ratios, "DSCR", "ratio_dscr_final");
  if (dscr !== null && dscr >= 1.50) {
    strengths.push({
      title: "Strong debt service coverage",
      narrative: sub(STRENGTH_NARRATIVES.strong_liquidity.template, {
        current_ratio: fmtX(dscr), percentile: "N/A",
        naics_description: getNaicsDesc(input), working_capital: "N/A", months: "N/A",
      }),
    });
  }

  // Strong liquidity
  const currentRatio = getNum(input.ratios, "CURRENT_RATIO", "ratio_current");
  if (currentRatio !== null && currentRatio >= 2.0) {
    const wc = getFactNum(input.canonical_facts, "bs_working_capital") ?? getFactNum(input.canonical_facts, "WORKING_CAPITAL");
    strengths.push({
      title: "Strong liquidity position",
      narrative: sub(STRENGTH_NARRATIVES.strong_liquidity.template, {
        current_ratio: fmtX(currentRatio), percentile: "75+",
        naics_description: getNaicsDesc(input),
        working_capital: wc !== null ? fmtDollars(wc) : "N/A",
        months: "6+",
      }),
    });
  }

  // Clean QoE
  if (qoeReport) {
    const pct = qoeReport.reportedEbitda > 0
      ? Math.abs(qoeReport.adjustmentTotal / qoeReport.reportedEbitda)
      : 0;
    if (pct <= 0.05) {
      strengths.push({
        title: "Clean quality of earnings",
        narrative: sub(STRENGTH_NARRATIVES.clean_qoe.template, {
          ebitda: fmtDollars(qoeReport.adjustedEbitda > 0 ? qoeReport.adjustedEbitda : qoeReport.reportedEbitda),
        }),
      });
    }
  }

  // Long operating history
  const yearsAvail = input.years_available.length;
  if (yearsAvail >= 3) {
    strengths.push({
      title: "Established operating history",
      narrative: sub(STRENGTH_NARRATIVES.long_operating_history.template, {
        years: String(yearsAvail),
      }),
    });
  }

  return strengths.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Resolution narrative
// ---------------------------------------------------------------------------

function buildResolutionNarrative(input: SpreadOutputInput, policy: SpreadOutputInput["bank_policy"] & object): string {
  const standaloneDscr = getNum(input.ratios, "DSCR", "ratio_dscr_final");
  const globalDscr = getNum(input.ratios, "global_dscr", "ratio_dscr_global");
  const policyMin = policy.dscr_minimum;

  if (standaloneDscr === null || standaloneDscr >= policyMin) return "";

  const standaloneAssessment = standaloneDscr < 1.0
    ? "does not cover debt service"
    : "is below the policy minimum";

  if (globalDscr !== null && globalDscr >= policyMin) {
    return sub(GLOBAL_NARRATIVES.global_resolves_standalone.template, {
      standalone_dscr: fmtX(standaloneDscr),
      standalone_assessment: standaloneAssessment,
      entity_description: "related entities",
      global_dscr: fmtX(globalDscr),
    });
  }

  if (globalDscr !== null && globalDscr < policyMin) {
    return sub(GLOBAL_NARRATIVES.global_insufficient.template, {
      standalone_dscr: fmtX(standaloneDscr),
      global_dscr: fmtX(globalDscr),
    });
  }

  return "";
}

// ---------------------------------------------------------------------------
// Final narrative — 3-5 sentences, every sentence with a number
// ---------------------------------------------------------------------------

function buildFinalNarrative(
  input: SpreadOutputInput,
  dscr: number | null,
  risks: StoryElement[],
  strengths: StoryElement[],
  resolution: string,
): string {
  const parts: string[] = [];

  // Sentence 1: Business overview with revenue
  const revenue = getFactNum(input.canonical_facts, "TOTAL_REVENUE")
    ?? getFactNum(input.canonical_facts, "is_gross_revenue")
    ?? getFactNum(input.canonical_facts, "GROSS_RECEIPTS");
  const entityName = String(input.canonical_facts["entity_name"] ?? input.canonical_facts["borrower_name"] ?? "The borrower");
  if (revenue !== null) {
    parts.push(`${entityName} generates ${fmtDollars(revenue)} in annual revenue across ${input.years_available.length} year(s) of available data.`);
  } else {
    parts.push(`${entityName} has ${input.years_available.length} year(s) of financial data available for analysis.`);
  }

  // Sentence 2: Coverage assessment
  if (dscr !== null) {
    if (dscr >= 1.50) {
      parts.push(`Debt service coverage of ${fmtX(dscr)}x provides a strong margin of safety.`);
    } else if (dscr >= 1.25) {
      parts.push(`Debt service coverage of ${fmtX(dscr)}x meets policy minimums with adequate cushion.`);
    } else if (dscr >= 1.0) {
      parts.push(`Debt service coverage of ${fmtX(dscr)}x is thin and warrants covenant protection.`);
    } else {
      parts.push(`Debt service coverage of ${fmtX(dscr)}x does not cover proposed obligations.`);
    }
  }

  // Sentence 3: Primary risk
  if (risks.length > 0) {
    parts.push(risks[0].title + ".");
  }

  // Sentence 4: Resolution or strength
  if (resolution) {
    // Summarize in one sentence
    parts.push("Consolidated analysis is recommended for final credit assessment.");
  } else if (strengths.length > 0) {
    parts.push(strengths[0].title + ".");
  }

  // Sentence 5: Recommendation
  const criticalCount = input.flag_report?.critical_count ?? 0;
  if (dscr !== null && dscr >= 1.50 && criticalCount === 0) {
    parts.push("The credit profile presents strong fundamentals for approval consideration.");
  } else if (dscr !== null && dscr >= 1.25 && criticalCount === 0) {
    parts.push("The credit profile presents adequate fundamentals with standard covenant protections.");
  } else if (dscr !== null && dscr >= 1.10) {
    parts.push("Marginal coverage requires enhanced monitoring and covenant protections.");
  } else {
    parts.push("Additional mitigants or structural enhancements are recommended before proceeding.");
  }

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Template substitution — NEVER leaves {curly_braces}
// ---------------------------------------------------------------------------

function sub(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), value);
  }
  // Safety: replace any remaining {placeholders} with "N/A"
  result = result.replace(/\{[a-z_]+\}/g, "N/A");
  return result;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtX(val: number): string {
  return val.toFixed(2);
}

function fmtDollars(val: number): string {
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(1)}M`;
  if (val >= 1_000) return `$${Math.round(val / 1_000).toLocaleString("en-US")}K`;
  return `$${Math.round(val).toLocaleString("en-US")}`;
}

function fmtPct(val: number): string {
  // If value looks like a decimal ratio (0-1), convert to percent
  if (val >= -1 && val <= 1) return (val * 100).toFixed(1);
  return val.toFixed(1);
}

function getNum(ratios: Record<string, number | null>, ...keys: string[]): number | null {
  for (const key of keys) {
    const val = ratios[key];
    if (val !== null && val !== undefined && isFinite(val)) return val;
  }
  return null;
}

function getFactNum(facts: Record<string, unknown>, key: string): number | null {
  const val = facts[key];
  if (val === null || val === undefined) return null;
  const n = Number(val);
  return isFinite(n) ? n : null;
}

function getNaicsDesc(input: SpreadOutputInput): string {
  return String(input.canonical_facts["naics_description"] ?? input.canonical_facts["naics_code"] ?? "this industry");
}
