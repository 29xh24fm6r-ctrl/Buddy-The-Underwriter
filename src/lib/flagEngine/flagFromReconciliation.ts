/**
 * Flag from Reconciliation — cross-document consistency checks.
 *
 * Pure function — no DB, no server imports.
 */

import type { FlagEngineInput, SpreadFlag } from "./types";
import { buildFlag, toNum, fmtDollars, fmtPct } from "./flagHelpers";
import { getRule } from "./flagRegistry";
import { generateQuestion } from "./questionGenerator";

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function flagFromReconciliation(input: FlagEngineInput): SpreadFlag[] {
  const flags: SpreadFlag[] = [];
  const { canonical_facts: facts, deal_id, years_available } = input;
  const latestYear = years_available.length > 0
    ? Math.max(...years_available)
    : undefined;

  // 1. Revenue variance: tax_gross_receipts vs fs_net_revenue (SAME YEAR ONLY)
  // Must compare year-keyed facts to avoid cross-period false positives
  // (e.g. 2024 full-year tax vs 2026 YTD income statement).
  for (const year of years_available) {
    const taxRevenue = toNum(facts[`GROSS_RECEIPTS_${year}`]);
    const fsRevenue = toNum(facts[`TOTAL_REVENUE_${year}`]);
    if (taxRevenue !== null && fsRevenue !== null && fsRevenue > 0) {
      const variance = Math.abs(taxRevenue - fsRevenue) / fsRevenue;
      if (variance > 0.03) {
        flags.push(makeReconFlag(
          deal_id, "revenue_variance_3pct", taxRevenue, year,
          `${year} tax return revenue differs from financial statements by ${fmtPct(variance)}.`,
          `${year} tax return gross receipts of ${fmtDollars(taxRevenue)} vs ${year} financial statement revenue of ${fmtDollars(fsRevenue)} — a variance of ${fmtDollars(Math.abs(taxRevenue - fsRevenue))} (${fmtPct(variance)}). This exceeds the 3% reconciliation threshold.`,
          `Unexplained revenue variances between tax and financial statement sources require clarification to ensure accurate underwriting.`,
          facts,
        ));
      }
    }
  }

  // 2. Schedule L variance: sl_total_assets vs fs_total_assets (SAME YEAR ONLY)
  for (const year of years_available) {
    const slAssets = toNum(facts[`SL_TOTAL_ASSETS_${year}`]);
    const fsAssets = toNum(facts[`TOTAL_ASSETS_${year}`]);
    if (slAssets !== null && fsAssets !== null && fsAssets > 0) {
      const variance = Math.abs(slAssets - fsAssets) / fsAssets;
      if (variance > 0.03) {
        flags.push(makeReconFlag(
          deal_id, "schedule_l_variance_3pct", slAssets, year,
          `${year} Schedule L total assets differ from financial statements by ${fmtPct(variance)}.`,
          `${year} Schedule L reports total assets of ${fmtDollars(slAssets)} vs ${year} financial statement total assets of ${fmtDollars(fsAssets)} — a variance of ${fmtDollars(Math.abs(slAssets - fsAssets))} (${fmtPct(variance)}).`,
          `Schedule L to financial statement variance may indicate book-to-tax timing differences or unreported transactions.`,
          facts,
        ));
      }
    }
  }

  // 3. Retained earnings rollforward (SAME YEAR)
  for (const year of years_available) {
    const reBegin = toNum(facts[`M2_RETAINED_EARNINGS_BEGIN_${year}`]);
    const reEnd = toNum(facts[`M2_RETAINED_EARNINGS_END_${year}`]);
    const netIncome = toNum(facts[`M2_NET_INCOME_BOOKS_${year}`]);
    const distributions = toNum(facts[`M2_DISTRIBUTIONS_${year}`]);
    if (reBegin !== null && reEnd !== null && netIncome !== null) {
      const expected = reBegin + netIncome - (distributions ?? 0);
      const discrepancy = Math.abs(expected - reEnd);
      if (discrepancy > 1000) {
        flags.push(makeReconFlag(
          deal_id, "retained_earnings_rollforward_mismatch", discrepancy, year,
          `${year} retained earnings rollforward has a ${fmtDollars(discrepancy)} discrepancy.`,
          `Expected ${year} ending retained earnings of ${fmtDollars(expected)} (beginning ${fmtDollars(reBegin)} + net income ${fmtDollars(netIncome)} - distributions ${fmtDollars(distributions ?? 0)}), but actual ending balance is ${fmtDollars(reEnd)}. Discrepancy: ${fmtDollars(discrepancy)}.`,
          `Retained earnings discrepancies may indicate unrecorded prior-period adjustments, reclassifications, or accounting errors.`,
          facts,
        ));
      }
    }
  }

  // 4. K-1 orphan detection
  const k1EntityEin = facts["K1_ENTITY_EIN"];
  const k1Income = toNum(facts["K1_ORDINARY_INCOME"]);
  const dealEntityIds = facts["deal_entity_ids"];
  if (k1EntityEin && k1Income !== null && k1Income !== 0) {
    const einStr = String(k1EntityEin);
    const entityIds = Array.isArray(dealEntityIds) ? dealEntityIds.map(String) : [];
    if (entityIds.length > 0 && !entityIds.includes(einStr)) {
      flags.push(makeReconFlag(
        deal_id, "k1_orphan_entity", k1Income, latestYear,
        `K-1 income of ${fmtDollars(k1Income)} from entity (EIN: ${einStr}) not included in deal analysis.`,
        `The personal tax return includes K-1 ordinary income of ${fmtDollars(k1Income)} from an entity with EIN ${einStr} that is not part of the current deal entity scope. This income should be analyzed for its impact on global cash flow.`,
        `Orphan K-1 income may represent material cash flow that should be included in the consolidated analysis, or it may be from an entity requiring separate review.`,
        facts,
      ));
    }
  }

  // 5. Large other income > 5% of revenue (SAME YEAR, prefer tax gross receipts denominator)
  for (const year of years_available) {
    const otherIncome = toNum(facts[`NON_RECURRING_INCOME_${year}`]);
    const denominator = toNum(facts[`GROSS_RECEIPTS_${year}`]) ?? toNum(facts[`TOTAL_REVENUE_${year}`]);
    if (otherIncome !== null && denominator !== null && denominator > 0) {
      const pct = otherIncome / denominator;
      if (pct > 0.05) {
        flags.push(makeReconFlag(
          deal_id, "large_other_income_5pct", otherIncome, year,
          `${year} other income of ${fmtDollars(otherIncome)} represents ${fmtPct(pct)} of revenue.`,
          `${year} other/non-recurring income of ${fmtDollars(otherIncome)} is ${fmtPct(pct)} of ${year} revenue (${fmtDollars(denominator)}). Items exceeding 5% of revenue require explanation and classification as recurring or non-recurring.`,
          `If non-recurring, this income should be excluded from normalized earnings. If recurring, it should be documented with supporting evidence.`,
          facts,
        ));
      }
    }
  }

  // 6. Large other expense > 5% of revenue (SAME YEAR, prefer tax gross receipts denominator)
  // Tax-derived OTHER_DEDUCTIONS must be measured against same-year tax GROSS_RECEIPTS,
  // not a different-period financial statement TOTAL_REVENUE.
  for (const year of years_available) {
    const otherExpense = toNum(facts[`OTHER_DEDUCTIONS_${year}`]);
    const denominator = toNum(facts[`GROSS_RECEIPTS_${year}`]) ?? toNum(facts[`TOTAL_REVENUE_${year}`]);
    if (otherExpense !== null && denominator !== null && denominator > 0) {
      const pct = otherExpense / denominator;
      if (pct > 0.05) {
        flags.push(makeReconFlag(
          deal_id, "large_other_expense_5pct", otherExpense, year,
          `${year} other deductions of ${fmtDollars(otherExpense)} represent ${fmtPct(pct)} of revenue.`,
          `${year} other deductions totaling ${fmtDollars(otherExpense)} represent ${fmtPct(pct)} of ${year} revenue (${fmtDollars(denominator)}). Large miscellaneous expense categories require itemization.`,
          `Unitemized expenses may contain non-recurring items that should be added back, or personal expenses that require normalization.`,
          facts,
        ));
      }
    }
  }

  // 7. Other deductions detail-sum reconciliation
  // If detail was extracted (OD_DETAIL_TOTAL exists), verify it reconciles to aggregate
  for (const year of years_available) {
    const aggregate = toNum(facts[`OTHER_DEDUCTIONS_${year}`]);
    const detailTotal = toNum(facts[`OD_DETAIL_TOTAL_${year}`]);
    if (aggregate !== null && detailTotal !== null) {
      const mismatch = Math.abs(aggregate - detailTotal);
      if (mismatch > 1) { // $1 tolerance for rounding
        flags.push(makeReconFlag(
          deal_id, "other_deductions_detail_sum_mismatch", mismatch, year,
          `${year} other deductions detail sum does not reconcile to aggregate (${fmtDollars(mismatch)} difference).`,
          `${year} other deductions aggregate of ${fmtDollars(aggregate)} does not match sum of extracted detail lines (${fmtDollars(detailTotal)}). Difference: ${fmtDollars(mismatch)}.`,
          `Detail-sum mismatch may indicate missing line items in the extraction or rounding differences. Internal review required before relying on detail breakdown.`,
          facts,
        ));
      }
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeReconFlag(
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
    severity: rule?.default_severity ?? "elevated",
    canonicalKeys: rule?.canonical_keys_involved ?? [],
    observedValue,
    yearObserved,
    bankerSummary,
    bankerDetail,
    bankerImplication,
    borrowerQuestion: null,
  });

  if (rule?.generates_question) {
    const question = generateQuestion(flag, facts);
    if (question) {
      flag.borrower_question = question;
    } else {
      // Evidence gate suppressed the question — annotate for banker review
      flag.borrower_question = null;
      flag.banker_detail += "\n\n⚠ Borrower question suppressed: evidence does not meet quality gate (period alignment or source verification failed). Internal review required before sending to borrower.";
    }
  }

  return flag;
}
