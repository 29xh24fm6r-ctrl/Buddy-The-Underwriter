/**
 * SPEC-FINENGINE-FULL-SPREAD-1 — Phase 3a: the credit-officer balance sheet.
 *
 * Tangible / effective tangible net worth, adjusted net worth (asset-quality
 * haircuts), debt-to-ETNW, the net-worth reconciliation (undisclosed-distribution
 * detector), and asset-quality helpers. Pure; thresholds from the registry (NG3).
 */

import type { MetricResult, PolicyContext } from "@/lib/finengine/contracts";
import { div, withFloor } from "@/lib/finengine/metrics/helpers";

const z = (v: number | null | undefined): number => (v == null ? 0 : v);
function m(metric: string, value: number | null, inputs: Record<string, number>, explanation: string): MetricResult {
  return { metric, value, inputs, explanation };
}

/** TNW = net worth − intangibles (SBA variant: subtract goodwill only). */
export function tangibleNetWorth(netWorth: number | null, intangibles: number | null, opts?: { goodwillOnly?: boolean; goodwill?: number | null }): MetricResult {
  const subtract = opts?.goodwillOnly ? z(opts.goodwill) : z(intangibles);
  const value = netWorth == null ? null : z(netWorth) - subtract;
  return m("TANGIBLE_NET_WORTH", value, { netWorth: z(netWorth), intangibles: z(intangibles), goodwill: z(opts?.goodwill), goodwillOnly: opts?.goodwillOnly ? 1 : 0 },
    "TNW = net worth − intangibles (SBA variant: − goodwill only).");
}

export type EtnwParts = {
  bookNetWorth: number | null;
  minorityInterest?: number | null;
  dueFromInsiders?: number | null; // officers / stockholders / affiliates
  intangibles?: number | null;
  accumulatedAmortization?: number | null;
  subordinatedDebt?: number | null;
};

/**
 * ETNW = book net worth + minority interest − due-from-officers/stockholders/
 * affiliates − (intangibles + accumulated amortization) + subordinated debt.
 */
export function effectiveTangibleNetWorth(parts: EtnwParts): MetricResult {
  const value =
    parts.bookNetWorth == null
      ? null
      : z(parts.bookNetWorth) + z(parts.minorityInterest) - z(parts.dueFromInsiders) - (z(parts.intangibles) + z(parts.accumulatedAmortization)) + z(parts.subordinatedDebt);
  return m("EFFECTIVE_TANGIBLE_NET_WORTH", value, {
    bookNetWorth: z(parts.bookNetWorth), minorityInterest: z(parts.minorityInterest), dueFromInsiders: z(parts.dueFromInsiders),
    intangibles: z(parts.intangibles), accumulatedAmortization: z(parts.accumulatedAmortization), subordinatedDebt: z(parts.subordinatedDebt),
  }, "ETNW = book net worth + minority interest − due-from-insiders − (intangibles + accum. amortization) + subordinated debt.");
}

/** Adjusted net worth = TNW − itemized asset-quality haircuts. */
export function adjustedNetWorth(tnw: number | null, haircuts: Record<string, number>): MetricResult {
  const total = Object.values(haircuts).reduce((a, b) => a + b, 0);
  return m("ADJUSTED_NET_WORTH", tnw == null ? null : tnw - total, { tnw: z(tnw), totalHaircuts: total, ...haircuts },
    "Adjusted net worth = TNW − asset-quality haircuts (slow AR, obsolete inventory, prepaids, idle assets).");
}

/** Debt to effective TNW = (total liabilities − sub debt) ÷ ETNW. */
export function debtToEffectiveTNW(totalLiabilities: number | null, subDebt: number | null, etnw: number | null, ctx?: PolicyContext): MetricResult {
  const numerator = totalLiabilities == null ? null : z(totalLiabilities) - z(subDebt);
  return withFloor(
    m("DEBT_TO_ETNW", div(numerator, etnw), { totalLiabilities: z(totalLiabilities), subDebt: z(subDebt), etnw: z(etnw) },
      "Debt/ETNW = (total liabilities − subordinated debt) ÷ ETNW — the truest liquidation-scenario cushion."),
    "debt_to_etnw_max", ctx,
  );
}

export type NetWorthReconciliationInputs = {
  beginningEquity: number | null;
  netIncome: number | null;
  reportedDistributions: number | null;
  endingEquity: number | null;
  otherAdjustments?: number | null;
};

/**
 * Net-worth reconciliation — leakage/fraud detector.
 *   impliedDistributions    = beginningEquity + netIncome − endingEquity + otherAdjustments
 *   undisclosedDistributions = impliedDistributions − reportedDistributions
 * A non-zero residual beyond tolerance signals undisclosed distributions.
 */
export function netWorthReconciliation(i: NetWorthReconciliationInputs): MetricResult {
  const implied = z(i.beginningEquity) + z(i.netIncome) - z(i.endingEquity) + z(i.otherAdjustments);
  const undisclosed = implied - z(i.reportedDistributions);
  return m("NET_WORTH_RECONCILIATION", undisclosed, {
    beginningEquity: z(i.beginningEquity), netIncome: z(i.netIncome), endingEquity: z(i.endingEquity),
    otherAdjustments: z(i.otherAdjustments), reportedDistributions: z(i.reportedDistributions), impliedDistributions: implied,
  }, "Undisclosed distributions = (beginning equity + net income − ending equity + other adj.) − reported distributions. Non-zero = leakage/fraud flag.");
}

// ---- Asset-quality helpers -------------------------------------------------

export function arDilution(grossBillings: number | null, cashCollected: number | null): MetricResult {
  const dilution = grossBillings == null ? null : z(grossBillings) - z(cashCollected);
  return m("AR_DILUTION", div(dilution, grossBillings), { grossBillings: z(grossBillings), cashCollected: z(cashCollected) },
    "AR dilution = (gross billings − cash collected) ÷ gross billings — non-cash reductions eroding collateral value.");
}

export function fixedAssetAge(accumulatedDepreciation: number | null, grossPPE: number | null): MetricResult {
  return m("FIXED_ASSET_AGE", div(z(accumulatedDepreciation), z(grossPPE) === 0 ? null : z(grossPPE)), { accumulatedDepreciation: z(accumulatedDepreciation), grossPPE: z(grossPPE) },
    "Fixed-asset age = accumulated depreciation ÷ gross PP&E — a heavily-depreciated base signals looming replacement capex.");
}

export function netToGrossPPE(netPPE: number | null, grossPPE: number | null): MetricResult {
  return m("NET_TO_GROSS_PPE", div(netPPE, grossPPE), { netPPE: z(netPPE), grossPPE: z(grossPPE) },
    "Net ÷ gross PP&E — remaining useful life proxy (low = aged asset base).");
}

export function allowanceAdequacy(allowance: number | null, ar: number | null, historicalLossRate: number | null): MetricResult {
  const required = ar == null || historicalLossRate == null ? null : z(ar) * z(historicalLossRate);
  return m("ALLOWANCE_ADEQUACY", div(allowance, required), { allowance: z(allowance), ar: z(ar), historicalLossRate: z(historicalLossRate), requiredAllowance: z(required) },
    "Allowance adequacy = allowance ÷ (AR × historical loss rate); <1.0 = under-reserved.");
}
