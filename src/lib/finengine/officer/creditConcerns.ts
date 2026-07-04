/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 15: Credit Officer Brain.
 *
 * Generates banker-grade CONCERNS (not just metrics) from a consolidated credit
 * picture: trend, repayment, liquidity, leverage, collateral, management, and
 * industry concerns. Each concern is ranked, cites the supporting metrics, and
 * maps to a mitigant. Pure — reads signals, produces concerns; never writes.
 */

import type { PolicyContext } from "@/lib/finengine/contracts";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";

export type ConcernCategory =
  | "trend"
  | "repayment"
  | "liquidity"
  | "leverage"
  | "collateral"
  | "management"
  | "industry";

export type ConcernSeverity = "low" | "moderate" | "high";

export type CreditConcern = {
  code: string;
  category: ConcernCategory;
  severity: ConcernSeverity;
  title: string;
  supportingMetrics: Record<string, number | string>;
  recommendedMitigant: string;
  /** Composite rank (higher = more urgent). */
  rank: number;
};

export type OfficerInput = {
  /** Chronological (oldest → newest). */
  revenueSeries?: number[];
  ebitdaMarginSeries?: number[];
  workingCapitalSeries?: number[];
  totalDebtSeries?: number[];
  dscr?: number | null;
  dscrPriorYear?: number | null;
  currentRatio?: number | null;
  currentRatioPrior?: number | null;
  arDays?: number | null;
  ownerDistributions?: number | null;
  netIncome?: number | null;
  /** |tax income − statement income| / statement income. */
  taxVsStatementVariancePct?: number | null;
  aggressiveAddbacks?: boolean;
  collateralCoverage?: number | null;
  industryKeyRisks?: string[];
  /** Policy resolution context (product/tenant) — resolves LGD coverage band via the registry (NG4). */
  ctx?: PolicyContext;
};

const SEVERITY_RANK: Record<ConcernSeverity, number> = { low: 1, moderate: 2, high: 3 };
// Category urgency weight — repayment/liquidity dominate an officer's attention.
const CATEGORY_WEIGHT: Record<ConcernCategory, number> = {
  repayment: 6,
  liquidity: 5,
  collateral: 5,
  leverage: 4,
  trend: 3,
  management: 3,
  industry: 2,
};

function pct(from: number, to: number): number {
  if (from === 0) return to === 0 ? 0 : 1;
  return (to - from) / Math.abs(from);
}

function firstLast(series: number[] | undefined): [number, number] | null {
  if (!series || series.length < 2) return null;
  return [series[0], series[series.length - 1]];
}

function concern(
  input: OfficerInput,
  c: Omit<CreditConcern, "rank">,
): CreditConcern {
  return { ...c, rank: CATEGORY_WEIGHT[c.category] * SEVERITY_RANK[c.severity] };
}

export function detectConcerns(input: OfficerInput): CreditConcern[] {
  const out: CreditConcern[] = [];

  // 1. Revenue decline (trend).
  const rev = firstLast(input.revenueSeries);
  if (rev && rev[1] < rev[0]) {
    const d = pct(rev[0], rev[1]);
    out.push(concern(input, {
      code: "revenue_decline",
      category: "trend",
      severity: d < -0.1 ? "high" : "moderate",
      title: "Revenue is declining period over period",
      supportingMetrics: { revenueStart: rev[0], revenueEnd: rev[1], changePct: Number((d * 100).toFixed(1)) },
      recommendedMitigant: "Understand the driver (lost customer, pricing, market) and stress repayment on the lower run-rate.",
    }));
  }

  // 2. Margin compression (trend).
  const marg = firstLast(input.ebitdaMarginSeries);
  if (marg && marg[1] < marg[0]) {
    out.push(concern(input, {
      code: "margin_compression",
      category: "trend",
      severity: marg[0] - marg[1] > 0.03 ? "high" : "moderate",
      title: "EBITDA margin is compressing",
      supportingMetrics: { marginStart: marg[0], marginEnd: marg[1] },
      recommendedMitigant: "Assess cost inflation vs pricing power; confirm the trend is not structural.",
    }));
  }

  // 3. Weakening working capital (liquidity).
  const wc = firstLast(input.workingCapitalSeries);
  if (wc && wc[1] < wc[0]) {
    out.push(concern(input, {
      code: "weakening_working_capital",
      category: "liquidity",
      severity: wc[1] < 0 ? "high" : "moderate",
      title: "Working capital is weakening",
      supportingMetrics: { wcStart: wc[0], wcEnd: wc[1] },
      recommendedMitigant: "Confirm adequate liquidity/availability to fund the operating cycle.",
    }));
  }

  // 4. Rising debt (leverage).
  const debt = firstLast(input.totalDebtSeries);
  if (debt && debt[1] > debt[0]) {
    out.push(concern(input, {
      code: "rising_debt",
      category: "leverage",
      severity: pct(debt[0], debt[1]) > 0.25 ? "high" : "moderate",
      title: "Total debt is rising",
      supportingMetrics: { debtStart: debt[0], debtEnd: debt[1] },
      recommendedMitigant: "Confirm debt growth is funding productive assets, not covering losses.",
    }));
  }

  // 5. DSCR compression (repayment).
  if (input.dscr != null && input.dscrPriorYear != null && input.dscr < input.dscrPriorYear) {
    out.push(concern(input, {
      code: "dscr_compression",
      category: "repayment",
      severity: input.dscr < 1.2 ? "high" : "moderate",
      title: "Debt service coverage is compressing",
      supportingMetrics: { dscrPrior: input.dscrPriorYear, dscr: input.dscr },
      recommendedMitigant: "Set a DSCR covenant and monitor; identify the cash-flow driver.",
    }));
  }

  // 6. Weak DSCR level (repayment).
  if (input.dscr != null && input.dscr < 1.2) {
    out.push(concern(input, {
      code: "weak_dscr",
      category: "repayment",
      severity: input.dscr < 1.1 ? "high" : "moderate",
      title: "Debt service coverage is weak",
      supportingMetrics: { dscr: input.dscr },
      recommendedMitigant: "Require additional cash-flow or guarantor support to reach ≥1.20x.",
    }));
  }

  // 7. Declining liquidity (liquidity).
  if (
    input.currentRatio != null &&
    ((input.currentRatioPrior != null && input.currentRatio < input.currentRatioPrior) || input.currentRatio < 1)
  ) {
    out.push(concern(input, {
      code: "declining_liquidity",
      category: "liquidity",
      severity: input.currentRatio < 1 ? "high" : "moderate",
      title: "Liquidity is declining / below 1.0x",
      supportingMetrics: { currentRatio: input.currentRatio, prior: input.currentRatioPrior ?? "n/a" },
      recommendedMitigant: "Confirm the borrower can meet near-term obligations; consider a liquidity covenant.",
    }));
  }

  // 8. Stale AR (liquidity/collateral quality).
  if (input.arDays != null && input.arDays > 60) {
    out.push(concern(input, {
      code: "stale_ar",
      category: "liquidity",
      severity: input.arDays > 90 ? "high" : "moderate",
      title: "Accounts receivable are aging",
      supportingMetrics: { arDays: input.arDays },
      recommendedMitigant: "Review the aging for collectability; exclude over-90 from any borrowing base.",
    }));
  }

  // 9. Owner distributions exceed earnings (management/repayment).
  if (input.ownerDistributions != null && input.netIncome != null && input.ownerDistributions > input.netIncome) {
    out.push(concern(input, {
      code: "distributions_exceed_earnings",
      category: "management",
      severity: "moderate",
      title: "Owner distributions exceed net income",
      supportingMetrics: { distributions: input.ownerDistributions, netIncome: input.netIncome },
      recommendedMitigant: "Add a distribution limitation tied to covenant compliance.",
    }));
  }

  // 10. Inconsistent tax vs statements (management).
  if (input.taxVsStatementVariancePct != null && input.taxVsStatementVariancePct > 0.1) {
    out.push(concern(input, {
      code: "inconsistent_tax_statements",
      category: "management",
      severity: input.taxVsStatementVariancePct > 0.25 ? "high" : "moderate",
      title: "Tax returns and financial statements are inconsistent",
      supportingMetrics: { variancePct: Number((input.taxVsStatementVariancePct * 100).toFixed(1)) },
      recommendedMitigant: "Reconcile book-to-tax differences; determine which basis to underwrite.",
    }));
  }

  // 11. Excessive add-backs (repayment quality).
  if (input.aggressiveAddbacks) {
    out.push(concern(input, {
      code: "excessive_addbacks",
      category: "repayment",
      severity: "moderate",
      title: "EBITDA relies on aggressive / unsupported add-backs",
      supportingMetrics: { aggressiveAddbacks: "true" },
      recommendedMitigant: "Underwrite on recurring EBITDA; require support for each add-back.",
    }));
  }

  // 12. Collateral shortfall (collateral).
  if (input.collateralCoverage != null && input.collateralCoverage < 1) {
    // Elevated-LGD boundary resolved from the registry (NG4) — never hardcoded here.
    const lgdWeakBand = resolvePolicy("lgd_coverage_weak", input.ctx).effective ?? 0.75;
    out.push(concern(input, {
      code: "collateral_shortfall",
      category: "collateral",
      severity: input.collateralCoverage < lgdWeakBand ? "high" : "moderate",
      title: "Loan is not fully secured",
      supportingMetrics: { collateralCoverage: input.collateralCoverage },
      recommendedMitigant: "Take all available collateral and/or additional guarantor support.",
    }));
  }

  // 13. Industry concerns (industry).
  for (const risk of input.industryKeyRisks ?? []) {
    out.push(concern(input, {
      code: `industry_risk:${risk}`,
      category: "industry",
      severity: "low",
      title: `Industry risk: ${risk.replace(/_/g, " ")}`,
      supportingMetrics: { risk },
      recommendedMitigant: "Address the sector risk in the credit narrative and monitoring plan.",
    }));
  }

  return out;
}

export type CreditOfficerReview = {
  concerns: CreditConcern[];
  highCount: number;
  topConcern: CreditConcern | null;
};

/** Run all detectors and rank concerns most-urgent first. */
export function runCreditOfficerReview(input: OfficerInput): CreditOfficerReview {
  const concerns = detectConcerns(input).sort((a, b) => b.rank - a.rank);
  return {
    concerns,
    highCount: concerns.filter((c) => c.severity === "high").length,
    topConcern: concerns[0] ?? null,
  };
}
