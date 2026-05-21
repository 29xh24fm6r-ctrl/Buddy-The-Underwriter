/**
 * Pure computation functions for the Canonical Underwriting Synthesis Layer.
 *
 * PURITY NOTE: This file MUST NOT import "server-only" or any module that
 * transitively imports it. It is consumed by both the orchestrator (server)
 * and CI guard tests under node:test.
 */

// ── Types ──────────────────────────────────────────────────────────────

export type MissingInput = {
  factKey: string;
  reason: string;
};

export type CollateralInput = {
  estimated_value: number | null;
  advance_rate: number | null;
  item_type: string;
};

// ── Default advance rates (mirrors collateralLtv.ts) ─────────────────

export const DEFAULT_ADVANCE_RATES: Record<string, number> = {
  real_estate: 0.80,
  equipment: 0.75,
  accounts_receivable: 0.80,
  inventory: 0.50,
  blanket_lien: 0.70,
  vehicle: 0.75,
  other: 0.50,
};

// ── Sources & Uses ──────────────────────────────────────────────────────

export function computeSourcesUsesFacts(input: {
  loanAmount: number | null;
  proceedsTotal: number | null;
}): { facts: Record<string, number>; missing: MissingInput[] } {
  const { loanAmount, proceedsTotal } = input;
  const facts: Record<string, number> = {};
  const missing: MissingInput[] = [];

  if (loanAmount == null || loanAmount <= 0) {
    for (const k of ["BANK_LOAN_TOTAL", "TOTAL_PROJECT_COST", "BORROWER_EQUITY", "BORROWER_EQUITY_PCT"]) {
      missing.push({ factKey: k, reason: "no_loan_request_amount" });
    }
    return { facts, missing };
  }

  facts.BANK_LOAN_TOTAL = loanAmount;

  if (proceedsTotal != null && proceedsTotal > 0) {
    facts.TOTAL_PROJECT_COST = proceedsTotal;
    const equity = Math.max(0, proceedsTotal - loanAmount);
    facts.BORROWER_EQUITY = equity;
    facts.BORROWER_EQUITY_PCT = equity / proceedsTotal;
  } else {
    for (const k of ["TOTAL_PROJECT_COST", "BORROWER_EQUITY", "BORROWER_EQUITY_PCT"]) {
      missing.push({ factKey: k, reason: "no_proceeds_items" });
    }
  }

  return { facts, missing };
}

// ── Collateral ──────────────────────────────────────────────────────────

export function computeCollateralFactValues(input: {
  collateral: CollateralInput[];
  bankLoanTotal: number | null;
}): { facts: Record<string, number>; missing: MissingInput[] } {
  const { collateral, bankLoanTotal } = input;
  const facts: Record<string, number> = {};
  const missing: MissingInput[] = [];

  if (collateral.length === 0) {
    for (const k of [
      "COLLATERAL_GROSS_VALUE", "COLLATERAL_NET_VALUE", "COLLATERAL_DISCOUNTED_VALUE",
      "COLLATERAL_DISCOUNTED_COVERAGE", "LTV_GROSS", "LTV_NET",
    ]) {
      missing.push({ factKey: k, reason: "no_collateral_items" });
    }
    return { facts, missing };
  }

  let gross = 0;
  let net = 0;
  for (const item of collateral) {
    const g = item.estimated_value ?? 0;
    const rate = item.advance_rate ?? DEFAULT_ADVANCE_RATES[item.item_type] ?? 0.50;
    gross += g;
    net += g * rate;
  }

  if (gross > 0) {
    facts.COLLATERAL_GROSS_VALUE = gross;
  } else {
    missing.push({ factKey: "COLLATERAL_GROSS_VALUE", reason: "all_collateral_zero_value" });
  }

  if (net > 0) {
    facts.COLLATERAL_NET_VALUE = net;
    facts.COLLATERAL_DISCOUNTED_VALUE = net; // advance_rate IS the discount factor
  } else {
    missing.push({ factKey: "COLLATERAL_NET_VALUE", reason: "all_collateral_zero_lendable" });
    missing.push({ factKey: "COLLATERAL_DISCOUNTED_VALUE", reason: "all_collateral_zero_lendable" });
  }

  if (bankLoanTotal != null && bankLoanTotal > 0) {
    if (gross > 0) {
      facts.LTV_GROSS = bankLoanTotal / gross;
    } else {
      missing.push({ factKey: "LTV_GROSS", reason: "zero_gross_collateral" });
    }
    if (net > 0) {
      facts.LTV_NET = bankLoanTotal / net;
      facts.COLLATERAL_DISCOUNTED_COVERAGE = net / bankLoanTotal;
    } else {
      missing.push({ factKey: "LTV_NET", reason: "zero_net_collateral" });
      missing.push({ factKey: "COLLATERAL_DISCOUNTED_COVERAGE", reason: "zero_net_collateral" });
    }
  } else {
    for (const k of ["LTV_GROSS", "LTV_NET", "COLLATERAL_DISCOUNTED_COVERAGE"]) {
      missing.push({ factKey: k, reason: "no_loan_amount" });
    }
  }

  return { facts, missing };
}

// ── AR / Borrowing Base ────────────────────────────────────────────────

export type ArAgingInput = {
  total_ar: number | null;
  eligible_ar: number | null;
  ineligible_ar: number | null;
  advance_rate: number | null;
  net_availability: number | null;
};

export function computeArBorrowingBaseFacts(input: {
  arAging: ArAgingInput | null;
  bankLoanTotal: number | null;
}): { facts: Record<string, number>; missing: MissingInput[] } {
  const { arAging, bankLoanTotal } = input;
  const facts: Record<string, number> = {};
  const missing: MissingInput[] = [];

  if (arAging == null) {
    return { facts, missing }; // AR data is optional — no missing entries
  }

  const totalAr = arAging.total_ar;
  if (totalAr != null && totalAr > 0) {
    facts.AR_TOTAL = totalAr;
  }

  const eligible = arAging.eligible_ar;
  const ineligible = arAging.ineligible_ar;

  if (eligible != null && eligible >= 0) {
    facts.AR_ELIGIBLE = eligible;
  } else if (totalAr != null && ineligible != null) {
    // Derive eligible from total - ineligible
    const derived = totalAr - ineligible;
    if (derived >= 0) facts.AR_ELIGIBLE = derived;
  }

  if (ineligible != null && ineligible >= 0) {
    facts.AR_INELIGIBLE = ineligible;
  } else if (totalAr != null && eligible != null) {
    const derived = totalAr - eligible;
    if (derived >= 0) facts.AR_INELIGIBLE = derived;
  }

  const advanceRate = arAging.advance_rate;
  if (advanceRate != null && advanceRate > 0) {
    facts.AR_ADVANCE_RATE = advanceRate;
  }

  // Borrowing base value = eligible AR * advance rate
  const eligibleForCalc = facts.AR_ELIGIBLE;
  const rateForCalc = advanceRate ?? 0.80; // default 80% advance rate for AR
  if (eligibleForCalc != null && eligibleForCalc > 0) {
    facts.AR_BORROWING_BASE_VALUE = eligibleForCalc * rateForCalc;
  }

  // Availability = borrowing base value - outstanding draws (approximated as bankLoanTotal for LOC)
  if (arAging.net_availability != null) {
    facts.AR_BORROWING_BASE_AVAILABILITY = arAging.net_availability;
  } else if (facts.AR_BORROWING_BASE_VALUE != null && bankLoanTotal != null) {
    const avail = facts.AR_BORROWING_BASE_VALUE - bankLoanTotal;
    facts.AR_BORROWING_BASE_AVAILABILITY = Math.max(0, avail);
  }

  return { facts, missing };
}

// ── Financial Analysis ──────────────────────────────────────────────────

export function computeFinancialAnalysisFacts(input: {
  cashFlowAvailable: number | null;
  proposedAds: number | null;
  existingDebt: number | null;
  stressedAds: number | null;
}): { facts: Record<string, number>; missing: MissingInput[] } {
  const { cashFlowAvailable, proposedAds, existingDebt, stressedAds } = input;
  const facts: Record<string, number> = {};
  const missing: MissingInput[] = [];

  const totalAds =
    proposedAds != null || existingDebt != null
      ? (proposedAds ?? 0) + (existingDebt ?? 0)
      : null;

  if (totalAds != null && totalAds > 0) {
    facts.ANNUAL_DEBT_SERVICE = totalAds;
  } else {
    missing.push({ factKey: "ANNUAL_DEBT_SERVICE", reason: "no_structural_pricing" });
  }

  if (cashFlowAvailable != null && totalAds != null && totalAds > 0) {
    facts.DSCR = Math.round((cashFlowAvailable / totalAds) * 1000) / 1000;
    facts.EXCESS_CASH_FLOW = cashFlowAvailable - totalAds;
  } else if (cashFlowAvailable == null) {
    missing.push({ factKey: "DSCR", reason: "no_cash_flow_available" });
    missing.push({ factKey: "EXCESS_CASH_FLOW", reason: "no_cash_flow_available" });
  } else {
    missing.push({ factKey: "DSCR", reason: "no_debt_service" });
    missing.push({ factKey: "EXCESS_CASH_FLOW", reason: "no_debt_service" });
  }

  if (stressedAds != null && stressedAds > 0) {
    facts.ANNUAL_DEBT_SERVICE_STRESSED_300BPS = stressedAds;
    if (cashFlowAvailable != null) {
      facts.DSCR_STRESSED_300BPS = Math.round((cashFlowAvailable / stressedAds) * 1000) / 1000;
    } else {
      missing.push({ factKey: "DSCR_STRESSED_300BPS", reason: "no_cash_flow_available" });
    }
  } else {
    missing.push({ factKey: "ANNUAL_DEBT_SERVICE_STRESSED_300BPS", reason: "no_stressed_debt_service" });
    missing.push({ factKey: "DSCR_STRESSED_300BPS", reason: "no_stressed_debt_service" });
  }

  return { facts, missing };
}
