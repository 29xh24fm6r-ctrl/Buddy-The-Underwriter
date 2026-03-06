/**
 * Flag from Ratios — evaluate ratio values against thresholds and policy limits.
 *
 * Pure function — no DB, no server imports.
 */

import type { FlagEngineInput, SpreadFlag } from "./types";
import { buildFlag, toNum, fmt, fmtPct } from "./flagHelpers";
import { getRule } from "./flagRegistry";
import { generateQuestion } from "./questionGenerator";

// ---------------------------------------------------------------------------
// Policy defaults (later configurable per bank)
// ---------------------------------------------------------------------------

const POLICY_DEFAULTS = {
  dscr_minimum: 1.25,
  fccr_minimum: 1.15,
  current_ratio_minimum: 1.10,
  ltv_maximum: 0.75,
  debt_ebitda_maximum: 4.5,
};

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function flagFromRatios(input: FlagEngineInput): SpreadFlag[] {
  const flags: SpreadFlag[] = [];
  const { ratios, canonical_facts: facts, deal_id, years_available } = input;
  const latestYear = years_available.length > 0
    ? Math.max(...years_available)
    : undefined;

  // DSCR checks
  const dscr = ratios["DSCR"] ?? null;
  if (dscr !== null) {
    if (dscr < 1.0) {
      flags.push(makeRatioFlag(deal_id, "dscr_below_1x", dscr, latestYear,
        { min: 1.0, description: "DSCR must be at least 1.0x" },
        `DSCR of ${fmt(dscr)}x is below 1.0x — business cannot cover its debt service from cash flow.`,
        `The Debt Service Coverage Ratio of ${fmt(dscr)}x indicates that available cash flow is insufficient to meet annual debt service obligations. A DSCR below 1.0x means the business is generating less cash than needed to service its debt.`,
        `This is a fundamental credit concern. Without sufficient cash flow to cover debt payments, the borrower may need to rely on external sources of liquidity to remain current.`,
        facts,
      ));
    } else if (dscr < POLICY_DEFAULTS.dscr_minimum) {
      flags.push(makeRatioFlag(deal_id, "dscr_below_policy_minimum", dscr, latestYear,
        { min: POLICY_DEFAULTS.dscr_minimum, description: `DSCR must be at least ${POLICY_DEFAULTS.dscr_minimum}x per policy` },
        `DSCR of ${fmt(dscr)}x is below the policy minimum of ${fmt(POLICY_DEFAULTS.dscr_minimum)}x.`,
        `The Debt Service Coverage Ratio of ${fmt(dscr)}x is below the bank's policy minimum of ${fmt(POLICY_DEFAULTS.dscr_minimum)}x. While the business can cover debt service, the margin of safety is below institutional standards.`,
        `Approval will likely require mitigants such as additional collateral, a guarantee, or a policy exception documented in the credit memo.`,
        facts,
      ));
    }
    // Proximity check
    if (dscr >= POLICY_DEFAULTS.dscr_minimum && dscr < POLICY_DEFAULTS.dscr_minimum * 1.10) {
      flags.push(makeRatioFlag(deal_id, "dscr_proximity_within_10pct", dscr, latestYear,
        { min: POLICY_DEFAULTS.dscr_minimum, description: `DSCR policy minimum is ${POLICY_DEFAULTS.dscr_minimum}x` },
        `DSCR of ${fmt(dscr)}x is within 10% of the policy minimum of ${fmt(POLICY_DEFAULTS.dscr_minimum)}x.`,
        `While the DSCR of ${fmt(dscr)}x meets the policy minimum, it is close enough that a modest deterioration in cash flow could push it below the threshold.`,
        `Consider this proximity when structuring covenants and monitoring requirements.`,
        facts,
      ));
    }
  }

  // DSCR two-year decline
  if (years_available.length >= 2) {
    const sorted = [...years_available].sort((a, b) => a - b);
    const dscrValues: number[] = [];
    for (const yr of sorted) {
      const key = `DSCR_${yr}`;
      const val = toNum(ratios[key] ?? facts[key]);
      if (val !== null) dscrValues.push(val);
    }
    if (dscrValues.length >= 3 && dscrValues[dscrValues.length - 1] < dscrValues[dscrValues.length - 2] && dscrValues[dscrValues.length - 2] < dscrValues[dscrValues.length - 3]) {
      const currentDscr = dscrValues[dscrValues.length - 1];
      flags.push(makeRatioFlag(deal_id, "dscr_two_year_decline", currentDscr, latestYear,
        undefined,
        `DSCR has declined for 2 consecutive years, currently at ${fmt(currentDscr)}x.`,
        `DSCR trajectory: ${dscrValues.map((v) => fmt(v) + "x").join(" → ")}. The declining trend raises questions about the sustainability of cash flow coverage.`,
        `Declining DSCR may indicate deteriorating business performance or increasing leverage that warrants further investigation.`,
        facts,
      ));
    }
  }

  // FCCR check
  const fccr = ratios["FCCR"] ?? null;
  if (fccr !== null && fccr < 1.0) {
    flags.push(makeRatioFlag(deal_id, "fccr_below_1x", fccr, latestYear,
      { min: 1.0, description: "FCCR must be at least 1.0x" },
      `FCCR of ${fmt(fccr)}x is below 1.0x — fixed obligations exceed available cash flow.`,
      `The Fixed Charge Coverage Ratio of ${fmt(fccr)}x indicates that total fixed charges (debt service, lease payments, and other fixed obligations) exceed available cash flow.`,
      `This is a serious concern for debt repayment capacity, especially under stress scenarios.`,
      facts,
    ));
  }

  // Debt/EBITDA checks
  const debtEbitda = ratios["DEBT_TO_EBITDA"] ?? null;
  if (debtEbitda !== null) {
    if (debtEbitda > 5.0) {
      flags.push(makeRatioFlag(deal_id, "debt_ebitda_above_5x", debtEbitda, latestYear,
        { max: 5.0, description: "Debt/EBITDA should not exceed 5.0x" },
        `Debt-to-EBITDA of ${fmt(debtEbitda)}x exceeds 5.0x — highly leveraged.`,
        `A Debt-to-EBITDA ratio of ${fmt(debtEbitda)}x indicates that the business carries more than 5 years of earnings in debt. This level of leverage significantly limits financial flexibility.`,
        `High leverage increases vulnerability to earnings shocks and limits the ability to absorb new debt or operational setbacks.`,
        facts,
      ));
    } else if (debtEbitda > 4.0) {
      flags.push(makeRatioFlag(deal_id, "debt_ebitda_above_4x", debtEbitda, latestYear,
        { max: POLICY_DEFAULTS.debt_ebitda_maximum, description: `Debt/EBITDA policy maximum is ${POLICY_DEFAULTS.debt_ebitda_maximum}x` },
        `Debt-to-EBITDA of ${fmt(debtEbitda)}x exceeds 4.0x.`,
        `While below the 5.0x critical threshold, a Debt/EBITDA of ${fmt(debtEbitda)}x is elevated and suggests limited room for additional borrowing.`,
        `Monitor leverage trajectory and ensure covenant packages reflect the elevated risk profile.`,
        facts,
      ));
    }
    // Proximity
    if (debtEbitda > 0 && debtEbitda <= POLICY_DEFAULTS.debt_ebitda_maximum && debtEbitda > POLICY_DEFAULTS.debt_ebitda_maximum * 0.90) {
      flags.push(makeRatioFlag(deal_id, "debt_ebitda_proximity", debtEbitda, latestYear,
        { max: POLICY_DEFAULTS.debt_ebitda_maximum, description: `Debt/EBITDA policy maximum is ${POLICY_DEFAULTS.debt_ebitda_maximum}x` },
        `Debt-to-EBITDA of ${fmt(debtEbitda)}x is within 10% of the policy maximum of ${fmt(POLICY_DEFAULTS.debt_ebitda_maximum)}x.`,
        `The leverage ratio is approaching the policy ceiling, leaving limited headroom.`,
        `Consider tighter monitoring covenants or step-down requirements.`,
        facts,
      ));
    }
  }

  // DSO checks
  const dso = ratios["DSO"] ?? null;
  if (dso !== null && dso > 90) {
    flags.push(makeRatioFlag(deal_id, "dso_above_90", dso, latestYear,
      { max: 90, description: "DSO above 90 days indicates collection issues" },
      `DSO of ${Math.round(dso)} days exceeds 90-day threshold.`,
      `Days Sales Outstanding of ${Math.round(dso)} days means the business takes an average of ${Math.round(dso)} days to collect receivables, significantly above the 90-day benchmark.`,
      `Elevated DSO ties up working capital and may indicate customer credit quality concerns or billing/collection process weaknesses.`,
      facts,
    ));
  }

  // Current ratio checks
  const currentRatio = ratios["CURRENT_RATIO"] ?? null;
  if (currentRatio !== null) {
    if (currentRatio < 1.0) {
      flags.push(makeRatioFlag(deal_id, "current_ratio_below_1x", currentRatio, latestYear,
        { min: 1.0, description: "Current ratio must be at least 1.0x" },
        `Current ratio of ${fmt(currentRatio)}x is below 1.0x.`,
        `A current ratio of ${fmt(currentRatio)}x indicates that current liabilities exceed current assets by ${fmtPct(1 - currentRatio)}. This is a liquidity concern.`,
        `Inability to meet short-term obligations without additional financing is a fundamental credit risk.`,
        facts,
      ));
    } else if (currentRatio < POLICY_DEFAULTS.current_ratio_minimum) {
      flags.push(makeRatioFlag(deal_id, "current_ratio_below_policy", currentRatio, latestYear,
        { min: POLICY_DEFAULTS.current_ratio_minimum, description: `Current ratio policy minimum is ${POLICY_DEFAULTS.current_ratio_minimum}x` },
        `Current ratio of ${fmt(currentRatio)}x is below the policy minimum of ${fmt(POLICY_DEFAULTS.current_ratio_minimum)}x.`,
        `While above 1.0x, the current ratio of ${fmt(currentRatio)}x provides limited liquidity cushion.`,
        `May require policy exception or additional liquidity mitigants.`,
        facts,
      ));
    }
    // Proximity
    if (currentRatio >= POLICY_DEFAULTS.current_ratio_minimum && currentRatio < POLICY_DEFAULTS.current_ratio_minimum * 1.10) {
      flags.push(makeRatioFlag(deal_id, "current_ratio_proximity", currentRatio, latestYear,
        { min: POLICY_DEFAULTS.current_ratio_minimum, description: `Current ratio policy minimum is ${POLICY_DEFAULTS.current_ratio_minimum}x` },
        `Current ratio of ${fmt(currentRatio)}x is within 10% of the policy minimum.`,
        `The current ratio is close to the policy floor, leaving limited cushion for working capital fluctuations.`,
        `Consider liquidity covenant or minimum cash balance requirement.`,
        facts,
      ));
    }
  }

  // LTV checks
  const ltv = ratios["LTV"] ?? null;
  if (ltv !== null) {
    if (ltv > 0.80) {
      flags.push(makeRatioFlag(deal_id, "ltv_above_80", ltv, latestYear,
        { max: 0.80, description: "LTV should not exceed 80%" },
        `LTV of ${fmtPct(ltv)} exceeds 80%.`,
        `Loan-to-Value of ${fmtPct(ltv)} means the loan amount exceeds 80% of collateral value, reducing the bank's recovery margin in a distress scenario.`,
        `High LTV increases loss severity in default. Consider additional collateral or equity injection.`,
        facts,
      ));
    }
    // Proximity
    if (ltv <= POLICY_DEFAULTS.ltv_maximum && ltv > POLICY_DEFAULTS.ltv_maximum - 0.05) {
      flags.push(makeRatioFlag(deal_id, "ltv_proximity_within_5pct", ltv, latestYear,
        { max: POLICY_DEFAULTS.ltv_maximum, description: `LTV policy maximum is ${fmtPct(POLICY_DEFAULTS.ltv_maximum)}` },
        `LTV of ${fmtPct(ltv)} is within 5 points of the policy maximum of ${fmtPct(POLICY_DEFAULTS.ltv_maximum)}.`,
        `The loan-to-value ratio is approaching the policy ceiling with limited cushion.`,
        `Any decline in collateral value could push LTV above policy limits.`,
        facts,
      ));
    }
  }

  // Gross margin compression
  const currentGM = ratios["GROSS_MARGIN"] ?? null;
  const priorGM = toNum(facts["GROSS_MARGIN_PRIOR"]);
  if (currentGM !== null && priorGM !== null && (priorGM - currentGM) > 0.05) {
    flags.push(makeRatioFlag(deal_id, "gross_margin_compressed_500bps", currentGM, latestYear,
      undefined,
      `Gross margin compressed by ${Math.round((priorGM - currentGM) * 10000)} basis points year-over-year to ${fmtPct(currentGM)}.`,
      `Gross margin declined from ${fmtPct(priorGM)} to ${fmtPct(currentGM)}, a compression of ${Math.round((priorGM - currentGM) * 10000)} basis points. This may reflect input cost increases, pricing pressure, or product mix changes.`,
      `Margin compression at this magnitude may indicate structural changes in the business's cost or pricing dynamics.`,
      facts,
    ));
  }

  // Revenue decline > 10%
  const currentRev = toNum(facts["TOTAL_REVENUE"]);
  const priorRev = toNum(facts["TOTAL_REVENUE_PRIOR"]);
  if (currentRev !== null && priorRev !== null && priorRev > 0) {
    const revChange = (currentRev - priorRev) / priorRev;
    if (revChange < -0.10) {
      flags.push(makeRatioFlag(deal_id, "revenue_declining_10pct", currentRev, latestYear,
        undefined,
        `Revenue declined ${fmtPct(Math.abs(revChange))} year-over-year.`,
        `Revenue declined from ${fmtDollars(priorRev)} to ${fmtDollars(currentRev)}, a decrease of ${fmtPct(Math.abs(revChange))}. This exceeds the 10% threshold for flagging.`,
        `Revenue decline of this magnitude requires explanation — it may reflect customer loss, market contraction, or strategic repositioning.`,
        facts,
      ));
    }

    // Revenue growing but margin compressing
    if (revChange > 0 && currentGM !== null && priorGM !== null && currentGM < priorGM) {
      flags.push(makeRatioFlag(deal_id, "revenue_growing_margin_compressing", currentRev, latestYear,
        undefined,
        `Revenue grew ${fmtPct(revChange)} but gross margin compressed from ${fmtPct(priorGM)} to ${fmtPct(currentGM)}.`,
        `Revenue increased ${fmtPct(revChange)} while gross margin declined ${Math.round((priorGM - currentGM) * 10000)} basis points. This pattern may indicate that growth is being achieved at the expense of profitability.`,
        `Unprofitable growth is not sustainable — investigate whether margin compression is temporary or structural.`,
        facts,
      ));
    }
  }

  // Cash conversion cycle > 90
  const ccc = ratios["CCC"] ?? null;
  if (ccc !== null && ccc > 90) {
    flags.push(makeRatioFlag(deal_id, "cash_conversion_cycle_above_90", ccc, latestYear,
      { max: 90, description: "CCC above 90 days indicates working capital strain" },
      `Cash conversion cycle of ${Math.round(ccc)} days exceeds 90-day threshold.`,
      `The cash conversion cycle of ${Math.round(ccc)} days means cash is tied up in working capital for an extended period. This consists of DSO (${Math.round(dso ?? 0)} days) + DIO (${Math.round(toNum(ratios["DIO"]) ?? 0)} days) - DPO (${Math.round(toNum(ratios["DPO"]) ?? 0)} days).`,
      `Extended CCC increases working capital financing needs and sensitivity to revenue fluctuations.`,
      facts,
    ));
  }

  // Tangible net worth thin
  const tnw = toNum(facts["TANGIBLE_NET_WORTH"]);
  const totalAssets = toNum(facts["TOTAL_ASSETS"]);
  if (tnw !== null && totalAssets !== null && totalAssets > 0 && tnw > 0 && tnw / totalAssets < 0.10) {
    flags.push(makeRatioFlag(deal_id, "tnw_thin_positive", tnw, latestYear,
      { description: "TNW should be meaningful relative to total assets" },
      `Tangible net worth of ${fmtDollars(tnw)} is thin at ${fmtPct(tnw / totalAssets)} of total assets.`,
      `While positive, the tangible net worth represents only ${fmtPct(tnw / totalAssets)} of total assets, leaving limited cushion against asset value declines.`,
      `Thin TNW increases vulnerability to balance sheet shocks and may limit borrowing capacity.`,
      facts,
    ));
  }

  // Post-close liquidity thin
  const postCloseLiq = toNum(facts["post_close_liquidity"]);
  if (postCloseLiq !== null && postCloseLiq > 0 && postCloseLiq < 50_000) {
    flags.push(makeRatioFlag(deal_id, "post_close_liquidity_thin", postCloseLiq, latestYear,
      { description: "Post-close liquidity should provide adequate cushion" },
      `Post-close liquidity of ${fmtDollars(postCloseLiq)} is thin.`,
      `After closing, the borrower/guarantor will have limited liquid reserves of ${fmtDollars(postCloseLiq)}, which may be insufficient to handle unexpected expenses or business disruptions.`,
      `Thin post-close liquidity increases the probability of early-stage delinquency.`,
      facts,
    ));
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function makeRatioFlag(
  dealId: string,
  triggerType: string,
  observedValue: number | string | null,
  yearObserved: number | undefined,
  expectedRange: { min?: number; max?: number; description: string } | undefined,
  bankerSummary: string,
  bankerDetail: string,
  bankerImplication: string,
  facts: Record<string, unknown>,
): SpreadFlag {
  const rule = getRule(triggerType);
  const flagBase = buildFlag({
    dealId,
    triggerType,
    category: rule?.category ?? "financial_irregularity",
    severity: rule?.default_severity ?? "watch",
    canonicalKeys: rule?.canonical_keys_involved ?? [],
    observedValue,
    expectedRange,
    yearObserved,
    bankerSummary,
    bankerDetail,
    bankerImplication,
    borrowerQuestion: null,
  });

  if (rule?.generates_question) {
    flagBase.borrower_question = generateQuestion(flagBase, facts);
  }

  return flagBase;
}

// Re-export for use by other importers
function fmtDollars(n: number): string {
  return "$" + Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
