// src/lib/sba/sbaGlobalCashFlow.ts
// Phase BPG — Global cash flow analysis (business + all guarantors).
// Pure function. Combines business EBITDA with each 20%+ guarantor's net
// personal cash (income - obligations) to compute a Global DSCR.

import { globalDscr as finengineGlobalDscr } from "@/lib/finengine/metrics/ratios";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";

export interface GuarantorCashFlow {
  entityId: string;
  name: string;
  ownershipPct: number;
  // Income
  w2Salary: number;
  otherPersonalIncome: number;
  // Obligations
  mortgagePayment: number;
  autoPayments: number;
  studentLoans: number;
  creditCardMinimums: number;
  otherPersonalDebt: number;
}

export interface GuarantorSummary {
  entityId: string;
  name: string;
  ownershipPct: number;
  personalIncome: number;
  personalObligations: number;
  netPersonalCash: number;
  negativeCashFlow: boolean;
}

export interface GlobalCashFlowResult {
  businessEbitda: number;
  businessDebtService: number;
  guarantors: GuarantorSummary[];
  totalPersonalIncome: number;
  totalPersonalObligations: number;
  totalNetPersonalCash: number;
  globalCashAvailable: number;
  globalDebtService: number;
  globalDSCR: number;
  guarantorsWithNegativeCashFlow: number;
  meetsSbaThreshold: boolean; // single source of truth: finengine's dscr_floor axis
}

export interface ComputeGlobalCashFlowInput {
  businessEbitda: number;
  businessDebtService: number;
  guarantors: GuarantorCashFlow[];
}

export function computeGlobalCashFlow(
  input: ComputeGlobalCashFlowInput,
): GlobalCashFlowResult {
  const { businessEbitda, businessDebtService, guarantors } = input;

  const summaries: GuarantorSummary[] = guarantors.map((g) => {
    const personalIncome = (g.w2Salary || 0) + (g.otherPersonalIncome || 0);
    const personalObligations =
      (g.mortgagePayment || 0) +
      (g.autoPayments || 0) +
      (g.studentLoans || 0) +
      (g.creditCardMinimums || 0) +
      (g.otherPersonalDebt || 0);
    const netPersonalCash = personalIncome - personalObligations;
    return {
      entityId: g.entityId,
      name: g.name,
      ownershipPct: g.ownershipPct,
      personalIncome,
      personalObligations,
      netPersonalCash,
      negativeCashFlow: netPersonalCash < 0,
    };
  });

  const totalPersonalIncome = summaries.reduce(
    (s, g) => s + g.personalIncome,
    0,
  );
  const totalPersonalObligations = summaries.reduce(
    (s, g) => s + g.personalObligations,
    0,
  );
  const totalNetPersonalCash = summaries.reduce(
    (s, g) => s + g.netPersonalCash,
    0,
  );

  const globalCashAvailable = businessEbitda + totalNetPersonalCash;
  const globalDebtService = businessDebtService; // personal obligations already subtracted above
  // Single source of truth for both the formula and the threshold:
  // finengine/metrics/ratios::globalDscr (SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 /
  // directive 2026-07-14). Preserves this function's existing 0 sentinel for
  // "no debt service to divide by" (finengine's div() returns null there).
  const globalDscrResult = finengineGlobalDscr(globalCashAvailable, globalDebtService);
  const globalDSCR = globalDscrResult.value ?? 0;
  const dscrThreshold = resolvePolicy("dscr_floor").effective ?? 1.25;

  return {
    businessEbitda,
    businessDebtService,
    guarantors: summaries,
    totalPersonalIncome,
    totalPersonalObligations,
    totalNetPersonalCash,
    globalCashAvailable,
    globalDebtService,
    globalDSCR,
    guarantorsWithNegativeCashFlow: summaries.filter((g) => g.negativeCashFlow)
      .length,
    meetsSbaThreshold: globalDSCR >= dscrThreshold,
  };
}
