/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — Phase 4: unified metric library.
 *
 * Every credit ratio in ONE place, each returning a MetricResult with the full
 * input set (explainability), the registry-resolved policy applied, and a
 * pass/fail against that policy. ALL floors/limits come from the policy registry
 * (NG4) — no hardcoded thresholds here.
 *
 * The DSCR family fixes the "denominator = proposed loan only" bug: the canonical
 * coverage denominator is GLOBAL debt service per profile (the caller passes the
 * global figure; `proposedLoanCoverage` is a separate, explicitly-named metric).
 *
 * Pure — no DB, no server-only.
 */

import type { MetricResult, PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";

const div = (a: number | null, b: number | null): number | null =>
  a == null || b == null || b === 0 ? null : a / b;

function withFloor(base: Omit<MetricResult, "policyApplied" | "passesFloor">, axis: string, ctx?: PolicyContext): MetricResult {
  const policy = resolvePolicy(axis, ctx);
  let passesFloor: boolean | undefined;
  if (base.value != null && policy.effective != null) {
    passesFloor = policy.direction === "floor" ? base.value >= policy.effective : base.value <= policy.effective;
  }
  return { ...base, policyApplied: policy, passesFloor };
}

// ---------------------------------------------------------------------------
// DSCR family — denominator is GLOBAL debt service (per profile), never proposed-only
// ---------------------------------------------------------------------------

export function dscr(cashAvailable: number | null, globalDebtService: number | null, ctx?: PolicyContext): MetricResult {
  const value = div(cashAvailable, globalDebtService);
  return withFloor(
    {
      metric: "DSCR",
      value,
      inputs: { cashAvailable: cashAvailable ?? 0, globalDebtService: globalDebtService ?? 0 },
      explanation: "DSCR = cash available for debt service ÷ GLOBAL debt service (all business + personal P&I, incl. the proposed loan).",
    },
    "dscr_floor",
    ctx,
  );
}

/** Proposed-loan-only coverage — explicitly NOT DSCR (kept separate so the two never conflate). */
export function proposedLoanCoverage(cashAvailable: number | null, proposedDebtService: number | null): MetricResult {
  const value = div(cashAvailable, proposedDebtService);
  return {
    metric: "PROPOSED_LOAN_COVERAGE",
    value,
    inputs: { cashAvailable: cashAvailable ?? 0, proposedDebtService: proposedDebtService ?? 0 },
    explanation: "Proposed-loan coverage = cash available ÷ proposed-loan debt service ONLY. This is not DSCR.",
  };
}

export function globalDscr(globalCashBeforeDebt: number | null, globalDebtService: number | null, ctx?: PolicyContext): MetricResult {
  const value = div(globalCashBeforeDebt, globalDebtService);
  return withFloor(
    {
      metric: "GCF_DSCR",
      value,
      inputs: { globalCashBeforeDebt: globalCashBeforeDebt ?? 0, globalDebtService: globalDebtService ?? 0 },
      explanation: "Global DSCR = global cash available ÷ global debt service.",
    },
    "dscr_floor",
    ctx,
  );
}

// ---------------------------------------------------------------------------
// Coverage ratios
// ---------------------------------------------------------------------------

export type FccrInputs = {
  cashAvailable: number | null;
  rent: number | null; // EBITDAR rent add-back
  capex: number | null;
  cashTaxes: number | null;
  distributions: number | null;
  fixedCharges: number | null; // debt service + rent + other fixed charges
};

export function fccr(i: FccrInputs, ctx?: PolicyContext): MetricResult {
  const numerator =
    (i.cashAvailable ?? 0) + (i.rent ?? 0) - (i.capex ?? 0) - (i.cashTaxes ?? 0) - (i.distributions ?? 0);
  const value = div(numerator, i.fixedCharges);
  return withFloor(
    {
      metric: "FCCR",
      value,
      inputs: {
        cashAvailable: i.cashAvailable ?? 0, rent: i.rent ?? 0, capex: i.capex ?? 0,
        cashTaxes: i.cashTaxes ?? 0, distributions: i.distributions ?? 0, fixedCharges: i.fixedCharges ?? 0,
      },
      explanation: "FCCR = (cash available + rent − capex − cash taxes − distributions) ÷ fixed charges (debt service + rent).",
    },
    "fccr_floor",
    ctx,
  );
}

export function icr(ebit: number | null, interestExpense: number | null): MetricResult {
  return {
    metric: "ICR",
    value: div(ebit, interestExpense),
    inputs: { ebit: ebit ?? 0, interestExpense: interestExpense ?? 0 },
    explanation: "ICR = EBIT ÷ interest expense.",
  };
}

// ---------------------------------------------------------------------------
// Leverage variants (gross + cash-netted)
// ---------------------------------------------------------------------------

export function leverageTotal(totalDebt: number | null, ebitda: number | null, ctx?: PolicyContext): MetricResult {
  return withFloor(
    {
      metric: "LEVERAGE_TOTAL",
      value: div(totalDebt, ebitda),
      inputs: { totalDebt: totalDebt ?? 0, ebitda: ebitda ?? 0 },
      explanation: "Total leverage = total debt ÷ EBITDA.",
    },
    "leverage_max",
    ctx,
  );
}

export function leverageCashNetted(totalDebt: number | null, cash: number | null, ebitda: number | null, ctx?: PolicyContext): MetricResult {
  const net = totalDebt == null ? null : totalDebt - (cash ?? 0);
  return withFloor(
    {
      metric: "LEVERAGE_TOTAL_NET",
      value: div(net, ebitda),
      inputs: { totalDebt: totalDebt ?? 0, cash: cash ?? 0, ebitda: ebitda ?? 0 },
      explanation: "Cash-netted leverage = (total debt − cash) ÷ EBITDA.",
    },
    "leverage_max",
    ctx,
  );
}

export function leverageSenior(seniorDebt: number | null, ebitda: number | null, ctx?: PolicyContext): MetricResult {
  return withFloor(
    {
      metric: "LEVERAGE_SENIOR",
      value: div(seniorDebt, ebitda),
      inputs: { seniorDebt: seniorDebt ?? 0, ebitda: ebitda ?? 0 },
      explanation: "Senior leverage = senior debt ÷ EBITDA.",
    },
    "leverage_max",
    ctx,
  );
}

// ---------------------------------------------------------------------------
// CRE / collateral ratios
// ---------------------------------------------------------------------------

export function debtYield(noi: number | null, loanAmount: number | null): MetricResult {
  return {
    metric: "DEBT_YIELD",
    value: div(noi, loanAmount),
    inputs: { noi: noi ?? 0, loanAmount: loanAmount ?? 0 },
    explanation: "Debt yield = NOI ÷ loan amount.",
  };
}

export function ltv(loanAmount: number | null, value: number | null, ctx?: PolicyContext): MetricResult {
  return withFloor(
    {
      metric: "LTV",
      value: div(loanAmount, value),
      inputs: { loanAmount: loanAmount ?? 0, value: value ?? 0 },
      explanation: "LTV = loan amount ÷ collateral value.",
    },
    "ltv_max",
    ctx,
  );
}

export function capRate(noi: number | null, value: number | null): MetricResult {
  return {
    metric: "CAP_RATE",
    value: div(noi, value),
    inputs: { noi: noi ?? 0, value: value ?? 0 },
    explanation: "Cap rate = NOI ÷ property value.",
  };
}

export function debtToTangibleNetWorth(totalDebt: number | null, tangibleNetWorth: number | null): MetricResult {
  return {
    metric: "DEBT_TO_TANGIBLE_NET_WORTH",
    value: div(totalDebt, tangibleNetWorth),
    inputs: { totalDebt: totalDebt ?? 0, tangibleNetWorth: tangibleNetWorth ?? 0 },
    explanation: "Debt / tangible net worth = total debt ÷ (net worth − intangibles).",
  };
}

// ---------------------------------------------------------------------------
// Liquidity
// ---------------------------------------------------------------------------

export function currentRatio(currentAssets: number | null, currentLiabilities: number | null): MetricResult {
  return {
    metric: "CURRENT_RATIO",
    value: div(currentAssets, currentLiabilities),
    inputs: { currentAssets: currentAssets ?? 0, currentLiabilities: currentLiabilities ?? 0 },
    explanation: "Current ratio = current assets ÷ current liabilities.",
  };
}

export function quickRatio(currentAssets: number | null, inventory: number | null, currentLiabilities: number | null): MetricResult {
  const quickAssets = currentAssets == null ? null : currentAssets - (inventory ?? 0);
  return {
    metric: "QUICK_RATIO",
    value: div(quickAssets, currentLiabilities),
    inputs: { currentAssets: currentAssets ?? 0, inventory: inventory ?? 0, currentLiabilities: currentLiabilities ?? 0 },
    explanation: "Quick ratio = (current assets − inventory) ÷ current liabilities.",
  };
}
