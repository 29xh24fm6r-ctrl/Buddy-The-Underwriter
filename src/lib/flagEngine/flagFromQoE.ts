/**
 * Flag from Quality of Earnings — checks QoE report for concerning adjustments.
 *
 * Pure function — no DB, no server imports.
 */

import type { FlagEngineInput, SpreadFlag } from "./types";
import { buildFlag, fmtDollars, fmtPct } from "./flagHelpers";
import { getRule } from "./flagRegistry";
import { generateQuestion } from "./questionGenerator";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function flagFromQoE(input: FlagEngineInput): SpreadFlag[] {
  if (!input.qoe_report) return [];

  const flags: SpreadFlag[] = [];
  const { qoe_report, deal_id, canonical_facts: facts, years_available } = input;
  const latestYear = years_available.length > 0
    ? Math.max(...years_available)
    : undefined;

  // 1. Low-confidence adjustments
  if (qoe_report.confidence === "low") {
    flags.push(makeQoEFlag(
      deal_id, "qoe_adjustment_low_confidence", qoe_report.adjustmentTotal, latestYear,
      `Quality of earnings analysis has low confidence — adjustments require additional documentation.`,
      `The QoE analysis confidence is "low", indicating that key adjustments lack sufficient documentation or involve uncertain classifications. Total adjustments: ${fmtDollars(qoe_report.adjustmentTotal)}.`,
      `Low-confidence QoE adjustments introduce uncertainty into the normalized earnings used for underwriting. Additional documentation is needed before relying on the adjusted EBITDA figure.`,
      facts,
    ));
  }

  // 2. Individual adjustment checks
  for (const adj of qoe_report.adjustments) {
    // ERC credit excluded
    if (adj.lineItem.toLowerCase().includes("erc") || adj.lineItem.toLowerCase().includes("employee retention")) {
      flags.push(makeQoEFlag(
        deal_id, "erc_credit_excluded", adj.amount, latestYear,
        `Employee Retention Credit of ${fmtDollars(adj.amount)} excluded from adjusted EBITDA.`,
        `An Employee Retention Credit of ${fmtDollars(adj.amount)} was identified and ${adj.direction === "deduct" ? "deducted from" : "excluded from"} normalized earnings. Source: ${adj.source}.`,
        `ERC is a one-time government credit that will not recur. Its exclusion is standard practice for normalized earnings.`,
        facts,
      ));
    }

    // Non-recurring income
    if (adj.classification === "non_recurring_income" && adj.amount > 0) {
      flags.push(makeQoEFlag(
        deal_id, "nonrecurring_income_present", adj.amount, latestYear,
        `Non-recurring income of ${fmtDollars(adj.amount)} identified: "${adj.lineItem}".`,
        `A non-recurring income item "${adj.lineItem}" of ${fmtDollars(adj.amount)} was identified (source: ${adj.source}). Direction: ${adj.direction}. Auto-approved: ${adj.autoApproved ? "yes" : "no"}.`,
        `Non-recurring income should not be included in the base earnings used for debt service coverage calculations.`,
        facts,
      ));
    }
  }

  // 3. Total adjustments exceed 20% of reported EBITDA
  if (qoe_report.reportedEbitda > 0) {
    const adjPct = Math.abs(qoe_report.adjustmentTotal) / qoe_report.reportedEbitda;
    if (adjPct > 0.20) {
      flags.push(makeQoEFlag(
        deal_id, "qoe_total_adjustments_exceed_20pct", qoe_report.adjustmentTotal, latestYear,
        `Total QoE adjustments of ${fmtDollars(Math.abs(qoe_report.adjustmentTotal))} are ${fmtPct(adjPct)} of reported EBITDA.`,
        `Total quality of earnings adjustments of ${fmtDollars(Math.abs(qoe_report.adjustmentTotal))} represent ${fmtPct(adjPct)} of reported EBITDA (${fmtDollars(qoe_report.reportedEbitda)}). Adjusted EBITDA: ${fmtDollars(qoe_report.adjustedEbitda)}. This exceeds the 20% materiality threshold.`,
        `When QoE adjustments materially change reported earnings, the reliability of the adjusted figure depends heavily on the quality of supporting documentation. Each adjustment should be individually validated.`,
        facts,
      ));
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeQoEFlag(
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
    category: rule?.category ?? "qualitative_risk",
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
