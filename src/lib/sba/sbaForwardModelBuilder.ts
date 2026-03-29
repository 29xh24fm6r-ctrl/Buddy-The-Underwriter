import type {
  SBAAssumptions,
  AnnualProjectionYear,
  MonthlyProjection,
  BreakEvenResult,
  SensitivityScenario,
  UseOfProceedsLine,
} from "./sbaReadinessTypes";

const SBA_DSCR_THRESHOLD = 1.25;
const DEFAULT_TAX_RATE = 0.25;
const CAPEX_DEPRECIATION_RATE = 0.2; // straight-line 5yr

/** Standard amortizing monthly payment */
function monthlyPayment(
  principal: number,
  annualRate: number,
  termMonths: number,
): number {
  if (annualRate <= 0) return principal / termMonths;
  const r = annualRate / 12;
  return (
    principal *
    ((r * Math.pow(1 + r, termMonths)) / (Math.pow(1 + r, termMonths) - 1))
  );
}

/** Pass 1: base year anchor from extracted facts */
export function buildBaseYear(params: {
  revenue: number;
  cogs: number;
  operatingExpenses: number;
  ebitda: number;
  depreciation: number;
  netIncome: number;
  existingDebtServiceAnnual: number;
}): AnnualProjectionYear {
  const grossProfit = params.revenue - params.cogs;
  const dscr =
    params.existingDebtServiceAnnual > 0
      ? params.ebitda / params.existingDebtServiceAnnual
      : 99;
  return {
    year: 0,
    label: "Actual",
    revenue: params.revenue,
    cogs: params.cogs,
    grossProfit,
    grossMarginPct: params.revenue > 0 ? grossProfit / params.revenue : 0,
    operatingExpenses: params.operatingExpenses,
    ebitda: params.ebitda,
    depreciation: params.depreciation,
    ebit: params.ebitda - params.depreciation,
    interestExpense: 0,
    taxEstimate: Math.max(0, params.netIncome * DEFAULT_TAX_RATE),
    netIncome: params.netIncome,
    totalDebtService: params.existingDebtServiceAnnual,
    dscr,
  };
}

/** Pass 2 + 3 + 4: annual projections Years 1–3 */
export function buildAnnualProjections(
  assumptions: SBAAssumptions,
  baseYear: AnnualProjectionYear,
): AnnualProjectionYear[] {
  const sbaMonthly = monthlyPayment(
    assumptions.loanImpact.loanAmount,
    assumptions.loanImpact.interestRate,
    assumptions.loanImpact.termMonths,
  );
  const sbaAnnual = sbaMonthly * 12;

  // Capex additions by year
  const newCapexByYear = [0, 0, 0, 0]; // index 1,2,3 used
  for (const cx of assumptions.costAssumptions.plannedCapex) {
    newCapexByYear[cx.year] += cx.amount;
  }

  let cumulativeNewDepreciation = 0;
  const years: AnnualProjectionYear[] = [];

  for (let y = 1; y <= 3; y++) {
    const prev = y === 1 ? baseYear : years[y - 2];

    // Revenue: compound each stream
    let revenue = 0;
    for (const stream of assumptions.revenueStreams) {
      const rates = [
        stream.growthRateYear1,
        stream.growthRateYear2,
        stream.growthRateYear3,
      ];
      let rev = stream.baseAnnualRevenue;
      for (let i = 0; i < y; i++) rev *= 1 + rates[i];
      // Add proceeds-driven revenue uplift
      if (
        assumptions.loanImpact.revenueImpactPct &&
        assumptions.loanImpact.revenueImpactStartMonth
      ) {
        if (y === 1) {
          const monthsInYear1 = Math.max(
            0,
            13 - assumptions.loanImpact.revenueImpactStartMonth,
          );
          rev +=
            rev *
            assumptions.loanImpact.revenueImpactPct *
            (monthsInYear1 / 12);
        } else {
          rev *= 1 + assumptions.loanImpact.revenueImpactPct;
        }
      }
      revenue += rev;
    }

    // COGS
    const cogsRates = [
      assumptions.costAssumptions.cogsPercentYear1,
      assumptions.costAssumptions.cogsPercentYear2,
      assumptions.costAssumptions.cogsPercentYear3,
    ];
    const cogs = revenue * cogsRates[y - 1];
    const grossProfit = revenue - cogs;

    // Fixed costs with annual escalation
    let fixedCosts = 0;
    for (const fc of assumptions.costAssumptions.fixedCostCategories) {
      fixedCosts += fc.annualAmount * Math.pow(1 + fc.escalationPctPerYear, y);
    }

    // New hires — prorated for start month
    let hireCost = 0;
    for (const hire of assumptions.costAssumptions.plannedHires) {
      const startInProjection = hire.startMonth;
      if (startInProjection <= y * 12) {
        const firstMonthThisYear = (y - 1) * 12 + 1;
        const lastMonthThisYear = y * 12;
        const monthsWorked = Math.max(
          0,
          Math.min(lastMonthThisYear, 36) -
            Math.max(firstMonthThisYear, startInProjection) +
            1,
        );
        hireCost += (hire.annualSalary / 12) * monthsWorked;
      }
    }

    const operatingExpenses = fixedCosts + hireCost;
    const ebitda = grossProfit - operatingExpenses;

    // Depreciation: base + cumulative from new capex
    cumulativeNewDepreciation += newCapexByYear[y] * CAPEX_DEPRECIATION_RATE;
    const depreciation =
      (baseYear.depreciation ?? 0) + cumulativeNewDepreciation;
    const ebit = ebitda - depreciation;

    // Existing debt service (checks if paid off by this year)
    const existingDS = assumptions.loanImpact.existingDebt.reduce((sum, d) => {
      const monthsElapsed = (y - 1) * 12;
      if (monthsElapsed >= d.remainingTermMonths) return sum;
      return sum + d.monthlyPayment * 12;
    }, 0);

    const totalDebtService = existingDS + sbaAnnual;
    const taxEstimate = Math.max(0, ebit * DEFAULT_TAX_RATE);
    const netIncome = ebit - taxEstimate;
    const dscr = totalDebtService > 0 ? ebitda / totalDebtService : 99;

    years.push({
      year: y as 1 | 2 | 3,
      label: "Projected",
      revenue,
      cogs,
      grossProfit,
      grossMarginPct: revenue > 0 ? grossProfit / revenue : 0,
      operatingExpenses,
      ebitda,
      depreciation,
      ebit,
      interestExpense:
        assumptions.loanImpact.interestRate *
        assumptions.loanImpact.loanAmount,
      taxEstimate,
      netIncome,
      totalDebtService,
      dscr,
      revenueGrowthPct:
        prev.revenue > 0 ? (revenue - prev.revenue) / prev.revenue : 0,
    });
  }

  return years;
}

/** Pass 4 (continued): monthly CF for Year 1 */
export function buildMonthlyProjections(
  assumptions: SBAAssumptions,
  year1: AnnualProjectionYear,
): MonthlyProjection[] {
  const sbaMonthly = monthlyPayment(
    assumptions.loanImpact.loanAmount,
    assumptions.loanImpact.interestRate,
    assumptions.loanImpact.termMonths,
  );
  const existingMonthly = assumptions.loanImpact.existingDebt.reduce(
    (sum, d) => sum + d.monthlyPayment,
    0,
  );
  const totalMonthlyDS = sbaMonthly + existingMonthly;
  const baseMonthlyRevenue = year1.revenue / 12;
  const baseMonthlyOpEx = (year1.cogs + year1.operatingExpenses) / 12;

  let cumulativeCash = 0;
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    // Apply seasonality from first stream if defined
    const firstStream = assumptions.revenueStreams[0];
    const seasonal = firstStream?.seasonalityProfile;
    const multiplier = seasonal ? seasonal[i] / 1 : 1;
    const revenue = baseMonthlyRevenue * multiplier;
    const operatingDisbursements = baseMonthlyOpEx;
    const netOperatingCF = revenue - operatingDisbursements;
    const netCash = netOperatingCF - totalMonthlyDS;
    cumulativeCash += netCash;
    return {
      month: m,
      revenue,
      operatingDisbursements,
      netOperatingCF,
      debtService: totalMonthlyDS,
      netCash,
      cumulativeCash,
    };
  });
}

/** Break-even computation */
export function computeBreakEven(
  assumptions: SBAAssumptions,
  year1: AnnualProjectionYear,
): BreakEvenResult {
  const fixedCostsAnnual = year1.operatingExpenses;
  const contributionMarginPct = year1.grossMarginPct;
  const breakEvenRevenue =
    contributionMarginPct > 0 ? fixedCostsAnnual / contributionMarginPct : 0;
  const projectedRevenueYear1 = year1.revenue;
  const marginOfSafetyPct =
    projectedRevenueYear1 > 0
      ? (projectedRevenueYear1 - breakEvenRevenue) / projectedRevenueYear1
      : 0;
  return {
    fixedCostsAnnual,
    contributionMarginPct,
    breakEvenRevenue,
    breakEvenUnits: null,
    projectedRevenueYear1,
    marginOfSafetyPct,
    flagLowMargin: marginOfSafetyPct < 0.1,
  };
}

/** Three-scenario sensitivity */
export function buildSensitivityScenarios(
  assumptions: SBAAssumptions,
  baseProjections: AnnualProjectionYear[],
): SensitivityScenario[] {
  const configs = [
    {
      name: "base" as const,
      label: "Base Case",
      revenueAdj: 0,
      cogsAdj: 0,
    },
    {
      name: "upside" as const,
      label: "Upside (+5% Revenue)",
      revenueAdj: 0.05,
      cogsAdj: -0.01,
    },
    {
      name: "downside" as const,
      label: "Downside (−15% Revenue)",
      revenueAdj: -0.15,
      cogsAdj: 0.02,
    },
  ];

  return configs.map((cfg) => {
    const adj: SBAAssumptions = {
      ...assumptions,
      revenueStreams: assumptions.revenueStreams.map((s) => ({
        ...s,
        growthRateYear1: s.growthRateYear1 + cfg.revenueAdj,
        growthRateYear2: s.growthRateYear2 + cfg.revenueAdj,
        growthRateYear3: s.growthRateYear3 + cfg.revenueAdj,
      })),
      costAssumptions: {
        ...assumptions.costAssumptions,
        cogsPercentYear1: Math.min(
          0.95,
          assumptions.costAssumptions.cogsPercentYear1 + cfg.cogsAdj,
        ),
        cogsPercentYear2: Math.min(
          0.95,
          assumptions.costAssumptions.cogsPercentYear2 + cfg.cogsAdj,
        ),
        cogsPercentYear3: Math.min(
          0.95,
          assumptions.costAssumptions.cogsPercentYear3 + cfg.cogsAdj,
        ),
      },
    };

    // Use the base year from baseProjections[0] as anchor for adjusted run
    const anchor: AnnualProjectionYear = {
      ...baseProjections[0],
      year: 0,
      label: "Actual",
    };
    const adjYears = buildAnnualProjections(adj, anchor);

    return {
      name: cfg.name,
      label: cfg.label,
      revenueGrowthAdjustment: cfg.revenueAdj,
      cogsAdjustment: cfg.cogsAdj,
      dscrYear1: adjYears[0]?.dscr ?? 0,
      dscrYear2: adjYears[1]?.dscr ?? 0,
      dscrYear3: adjYears[2]?.dscr ?? 0,
      revenueYear1: adjYears[0]?.revenue ?? 0,
      ebitdaMarginYear1:
        adjYears[0] && adjYears[0].revenue > 0
          ? adjYears[0].ebitda / adjYears[0].revenue
          : 0,
      passesSBAThreshold:
        (adjYears[0]?.dscr ?? 0) >= SBA_DSCR_THRESHOLD &&
        (adjYears[1]?.dscr ?? 0) >= SBA_DSCR_THRESHOLD &&
        (adjYears[2]?.dscr ?? 0) >= SBA_DSCR_THRESHOLD,
    };
  });
}

/** Use of proceeds from deal_proceeds_items */
export function buildUseOfProceeds(
  items: Array<{
    category: string;
    description?: string | null;
    amount: number;
  }>,
  _totalLoanAmount: number,
): UseOfProceedsLine[] {
  const total = items.reduce((s, i) => s + i.amount, 0);
  return items.map((item) => ({
    category: item.category,
    description: item.description ?? "",
    amount: item.amount,
    pctOfTotal: total > 0 ? item.amount / total : 0,
  }));
}
