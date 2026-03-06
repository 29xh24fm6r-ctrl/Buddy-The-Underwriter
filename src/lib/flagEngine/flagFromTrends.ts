/**
 * Flag from Trends — evaluate multi-year trend analysis for concerning patterns.
 *
 * Pure function — no DB, no server imports.
 */

import type { FlagEngineInput, SpreadFlag } from "./types";
import { buildFlag, toNum, fmt, fmtDollars, fmtPct } from "./flagHelpers";
import { getRule } from "./flagRegistry";
import { generateQuestion } from "./questionGenerator";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function flagFromTrends(input: FlagEngineInput): SpreadFlag[] {
  if (!input.trend_report) return [];

  const flags: SpreadFlag[] = [];
  const { trend_report, deal_id, canonical_facts: facts, years_available, ratios } = input;
  const latestYear = years_available.length > 0
    ? Math.max(...years_available)
    : undefined;

  // 1. EBITDA margin declining 2+ years
  if (trend_report.trendEbitda.direction === "DECLINING") {
    const values = trend_report.trendEbitda.values.filter((v): v is number => v !== null);
    const valStr = values.map((v) => fmtDollars(v)).join(" → ");
    const totalDecline = values.length >= 2
      ? fmtDollars(Math.abs(values[values.length - 1] - values[0]))
      : "N/A";

    flags.push(makeTrendFlag(
      deal_id, "ebitda_margin_declining_2yr", values[values.length - 1] ?? null, latestYear,
      `EBITDA has declined for 2+ consecutive years.`,
      `EBITDA trajectory: ${valStr}. Total decline: ${totalDecline} over ${values.length - 1} years. ${projectTrend(values, "EBITDA")}`,
      `Persistent EBITDA decline raises fundamental questions about the sustainability of cash flow available for debt service.`,
      facts,
    ));
  }

  // 2. Revenue declining 2+ years
  if (trend_report.trendRevenue.direction === "DECLINING") {
    const values = trend_report.trendRevenue.values.filter((v): v is number => v !== null);
    const valStr = values.map((v) => fmtDollars(v)).join(" → ");
    const pctDecline = values.length >= 2 && values[0] > 0
      ? fmtPct(Math.abs(values[values.length - 1] - values[0]) / values[0])
      : "N/A";

    flags.push(makeTrendFlag(
      deal_id, "revenue_declining_2yr", values[values.length - 1] ?? null, latestYear,
      `Revenue has declined for 2+ consecutive years (total decline: ${pctDecline}).`,
      `Revenue trajectory: ${valStr}. Total decline: ${pctDecline} over ${values.length - 1} years. ${projectTrend(values, "revenue")}`,
      `Multi-year revenue decline indicates potential structural issues — market contraction, competitive displacement, or customer attrition — that may not self-correct.`,
      facts,
    ));
  }

  // 3. Gross margin compressing (revenue growing, margin declining)
  if (trend_report.trendRevenue.direction === "POSITIVE" &&
      trend_report.trendGrossMargin.direction === "COMPRESSING") {
    const revValues = trend_report.trendRevenue.values.filter((v): v is number => v !== null);
    const gmValues = trend_report.trendGrossMargin.values.filter((v): v is number => v !== null);

    flags.push(makeTrendFlag(
      deal_id, "revenue_growing_margin_compressing",
      gmValues[gmValues.length - 1] ?? null, latestYear,
      `Revenue is growing but gross margins are compressing.`,
      `Revenue trend: ${revValues.map((v) => fmtDollars(v)).join(" → ")} (positive). Gross margin trend: ${gmValues.map((v) => fmtPct(v)).join(" → ")} (compressing). Growth is coming at the expense of profitability.`,
      `Revenue growth achieved through margin sacrifice is typically unsustainable. Investigate whether this reflects pricing strategy or cost pressure.`,
      facts,
    ));
  }

  // 4. Leverage increasing 2+ years
  if (trend_report.trendLeverage.direction === "WORSENING") {
    const values = trend_report.trendLeverage.values.filter((v): v is number => v !== null);
    const valStr = values.map((v) => fmt(v) + "x").join(" → ");

    flags.push(makeTrendFlag(
      deal_id, "leverage_increasing_2yr", values[values.length - 1] ?? null, latestYear,
      `Leverage (Debt/EBITDA) has been increasing for 2+ consecutive years.`,
      `Leverage trajectory: ${valStr}. ${projectTrend(values, "leverage", "x")}`,
      `Rising leverage indicates either growing debt or shrinking earnings, both of which increase credit risk.`,
      facts,
    ));
  }

  // 5. Working capital deteriorating
  const wcValues: number[] = [];
  for (const yr of [...years_available].sort((a, b) => a - b)) {
    const ca = toNum(facts[`TOTAL_CURRENT_ASSETS_${yr}`]);
    const cl = toNum(facts[`TOTAL_CURRENT_LIABILITIES_${yr}`]);
    if (ca !== null && cl !== null) {
      wcValues.push(ca - cl);
    }
  }
  // Fallback: check if we have current WC and prior WC
  if (wcValues.length < 2) {
    const currentCA = toNum(facts["TOTAL_CURRENT_ASSETS"]);
    const currentCL = toNum(facts["TOTAL_CURRENT_LIABILITIES"]);
    const priorCA = toNum(facts["TOTAL_CURRENT_ASSETS_PRIOR"]);
    const priorCL = toNum(facts["TOTAL_CURRENT_LIABILITIES_PRIOR"]);
    if (currentCA !== null && currentCL !== null && priorCA !== null && priorCL !== null) {
      const currentWC = currentCA - currentCL;
      const priorWC = priorCA - priorCL;
      if (currentWC < priorWC) {
        flags.push(makeTrendFlag(
          deal_id, "working_capital_deteriorating", currentWC, latestYear,
          `Working capital declined from ${fmtDollars(priorWC)} to ${fmtDollars(currentWC)}.`,
          `Working capital (current assets minus current liabilities) declined from ${fmtDollars(priorWC)} to ${fmtDollars(currentWC)}, a decrease of ${fmtDollars(Math.abs(priorWC - currentWC))}.`,
          `Deteriorating working capital may indicate growing operational strain or increasing reliance on short-term financing.`,
          facts,
        ));
      }
    }
  } else if (wcValues.length >= 2) {
    // Check if declining for 2+ periods
    let declining = true;
    for (let i = 1; i < wcValues.length; i++) {
      if (wcValues[i] >= wcValues[i - 1]) { declining = false; break; }
    }
    if (declining) {
      const valStr = wcValues.map((v) => fmtDollars(v)).join(" → ");
      flags.push(makeTrendFlag(
        deal_id, "working_capital_deteriorating",
        wcValues[wcValues.length - 1], latestYear,
        `Working capital has declined for ${wcValues.length - 1} consecutive years.`,
        `Working capital trajectory: ${valStr}. Total decline: ${fmtDollars(Math.abs(wcValues[wcValues.length - 1] - wcValues[0]))} over ${wcValues.length - 1} years. ${projectTrend(wcValues, "working capital")}`,
        `Persistent working capital deterioration may indicate fundamental liquidity issues that will worsen without intervention.`,
        facts,
      ));
    }
  }

  // Also check DSO trend
  if (trend_report.trendDso.direction === "DETERIORATING") {
    const values = trend_report.trendDso.values.filter((v): v is number => v !== null);
    if (values.length >= 2) {
      const increase = values[values.length - 1] - values[0];
      if (increase >= 15) {
        flags.push(makeTrendFlag(
          deal_id, "dso_increasing_15_days", values[values.length - 1], latestYear,
          `DSO increased by ${Math.round(increase)} days over ${values.length - 1} years (${values.map((v) => Math.round(v) + " days").join(" → ")}).`,
          `Days Sales Outstanding trajectory: ${values.map((v) => Math.round(v) + " days").join(" → ")}. Total increase of ${Math.round(increase)} days. ${projectTrend(values, "DSO", " days")}`,
          `Rising DSO suggests deteriorating collection efficiency or changes in customer payment behavior that may impair cash flow.`,
          facts,
        ));
      }
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Projection helper
// ---------------------------------------------------------------------------

function projectTrend(values: number[], metricName: string, unit = ""): string {
  if (values.length < 2) return "";
  const avgChange = (values[values.length - 1] - values[0]) / (values.length - 1);
  if (Math.abs(avgChange) < 0.01) return "";
  const direction = avgChange > 0 ? "increase" : "decrease";
  return `If this trend continues, ${metricName} would ${direction} by approximately ${Math.abs(Math.round(avgChange))}${unit} per year.`;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeTrendFlag(
  dealId: string,
  triggerType: string,
  observedValue: number | string | null,
  yearObserved: number | undefined,
  bankerSummary: string,
  bankerDetail: string,
  bankerImplication: string,
  facts: Record<string, unknown>,
): SpreadFlag {
  const rule = getRule(triggerType);
  const flag = buildFlag({
    dealId,
    triggerType,
    category: rule?.category ?? "financial_irregularity",
    severity: rule?.default_severity ?? "watch",
    canonicalKeys: rule?.canonical_keys_involved ?? [],
    observedValue,
    yearObserved,
    bankerSummary,
    bankerDetail,
    bankerImplication,
    borrowerQuestion: null,
  });

  if (rule?.generates_question) {
    flag.borrower_question = generateQuestion(flag, facts);
  }

  return flag;
}
