// src/lib/sba/sbaGlobalCashFlow.ts
// Phase BPG — Global cash flow analysis (business + all guarantors).
// Pure function. Combines business EBITDA with each 20%+ guarantor's net
// personal cash (income - obligations) to compute a Global DSCR.

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
  meetsSbaThreshold: boolean; // >= 1.25
}

const SBA_DSCR_THRESHOLD = 1.25;

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
  const globalDSCR =
    globalDebtService > 0 ? globalCashAvailable / globalDebtService : 0;

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
    meetsSbaThreshold: globalDSCR >= SBA_DSCR_THRESHOLD,
  };
}
