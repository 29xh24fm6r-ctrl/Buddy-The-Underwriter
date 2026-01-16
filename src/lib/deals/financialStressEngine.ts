import type { DealFinancialSnapshotV1, SnapshotMetricValue } from "@/lib/deals/financialSnapshotCore";

export type LoanTerms = {
  principal: number | null;
  rate: number | null; // decimal (0.08) or percent (8)
  amortMonths: number | null;
  interestOnly: boolean | null;
};

export type StressParams = {
  vacancyUpPct?: number; // e.g. 0.10 for +10%
  rentDownPct?: number; // e.g. 0.10 for -10%
  rateUpBps?: number; // e.g. 200
};

export type StressScenarioResult = {
  dscr: number | null;
  delta: number | null;
  cashFlow: number | null;
  annualDebtService: number | null;
};

export type FinancialStressResult = {
  base: StressScenarioResult;
  stresses: {
    vacancyUp: StressScenarioResult;
    rentDown: StressScenarioResult;
    rateUp: StressScenarioResult;
  };
};

function normalizeRate(rate: number | null): number | null {
  if (rate === null || !Number.isFinite(rate)) return null;
  if (rate > 1) return rate / 100;
  if (rate < 0) return null;
  return rate;
}

function toNum(v: SnapshotMetricValue | null | undefined): number | null {
  if (!v) return null;
  return typeof v.value_num === "number" ? v.value_num : null;
}

function computeAnnualDebtService(terms: LoanTerms): number | null {
  const principal = terms.principal ?? null;
  const rate = normalizeRate(terms.rate ?? null);
  const amortMonths = terms.amortMonths ?? null;
  const interestOnly = Boolean(terms.interestOnly);

  if (!principal || !rate || rate < 0) return null;

  if (interestOnly || !amortMonths || amortMonths <= 0) {
    return principal * rate;
  }

  const r = rate / 12;
  const n = amortMonths;
  if (r === 0) return (principal / n) * 12;

  const pmt = (principal * r) / (1 - Math.pow(1 + r, -n));
  return pmt * 12;
}

function computeDscr(cashFlow: number | null, annualDebtService: number | null): number | null {
  if (!cashFlow || !annualDebtService || annualDebtService === 0) return null;
  return cashFlow / annualDebtService;
}

function buildScenarioResult(args: {
  cashFlow: number | null;
  annualDebtService: number | null;
  baseDscr: number | null;
}): StressScenarioResult {
  const dscr = computeDscr(args.cashFlow, args.annualDebtService);
  return {
    dscr,
    delta: args.baseDscr !== null && dscr !== null ? dscr - args.baseDscr : null,
    cashFlow: args.cashFlow,
    annualDebtService: args.annualDebtService,
  };
}

export function computeFinancialStress(args: {
  snapshot: DealFinancialSnapshotV1;
  loanTerms: LoanTerms;
  stress?: StressParams;
}): FinancialStressResult {
  const stress = {
    vacancyUpPct: 0.1,
    rentDownPct: 0.1,
    rateUpBps: 200,
    ...(args.stress ?? {}),
  };

  const baseCashFlow =
    toNum(args.snapshot.cash_flow_available) ?? toNum(args.snapshot.noi_ttm) ?? null;

  const baseDebtService =
    toNum(args.snapshot.annual_debt_service) ?? computeAnnualDebtService(args.loanTerms);

  const baseDscr = computeDscr(baseCashFlow, baseDebtService);

  const base = buildScenarioResult({
    cashFlow: baseCashFlow,
    annualDebtService: baseDebtService,
    baseDscr,
  });

  const vacancyCashFlow =
    typeof baseCashFlow === "number"
      ? baseCashFlow * (1 - Math.max(0, stress.vacancyUpPct ?? 0))
      : null;

  const rentDownCashFlow =
    typeof baseCashFlow === "number"
      ? baseCashFlow * (1 - Math.max(0, stress.rentDownPct ?? 0))
      : null;

  const bumpedRate = (() => {
    const rate = normalizeRate(args.loanTerms.rate ?? null);
    if (rate === null) return null;
    return rate + (Math.max(0, stress.rateUpBps ?? 0) / 10000);
  })();

  const rateUpDebtService = bumpedRate
    ? computeAnnualDebtService({
        ...args.loanTerms,
        rate: bumpedRate,
      })
    : null;

  const vacancyUp = buildScenarioResult({
    cashFlow: vacancyCashFlow,
    annualDebtService: baseDebtService,
    baseDscr,
  });

  const rentDown = buildScenarioResult({
    cashFlow: rentDownCashFlow,
    annualDebtService: baseDebtService,
    baseDscr,
  });

  const rateUp = buildScenarioResult({
    cashFlow: baseCashFlow,
    annualDebtService: rateUpDebtService ?? baseDebtService,
    baseDscr,
  });

  return {
    base,
    stresses: {
      vacancyUp,
      rentDown,
      rateUp,
    },
  };
}
