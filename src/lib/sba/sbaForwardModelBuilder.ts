import type {
  SBAAssumptions,
  AnnualProjectionYear,
  MonthlyProjection,
  BreakEvenResult,
  RevenueStream,
  RevenueStreamProjection,
  SensitivityScenario,
  UseOfProceedsLine,
} from "./sbaReadinessTypes";
import { dscr as finengineDscr } from "@/lib/finengine/metrics/ratios";
import { resolvePolicy } from "@/lib/finengine/policyRegistry";
import { buildProjectionLedger, debtYear, PROJECTION_TAX_RATE, type ProjectionLedger } from "./sbaProjectionLedger";


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
  // Single source of truth for the DSCR formula: finengine/metrics/ratios::dscr
  // (SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 / directive 2026-07-14). 99 is this
  // model's existing sentinel for "no debt service to cover" — finengine's
  // div() returns null for a zero/null denominator, so that sentinel mapping
  // stays here rather than leaking finengine-specific null-handling into
  // every caller of buildBaseYear.
  const dscr = finengineDscr(params.ebitda, params.existingDebtServiceAnnual).value ?? 99;
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
    taxEstimate: Math.max(0, params.netIncome * PROJECTION_TAX_RATE),
    netIncome: params.netIncome,
    totalDebtService: params.existingDebtServiceAnnual,
    dscr,
  };
}

/**
 * Single-stream revenue compounded to year `y` (1, 2, or 3), including the
 * proceeds-driven revenue uplift when the loan amplifies the borrower's
 * revenue (e.g. equipment funded by SBA proceeds comes online in month N).
 *
 * Pure: no side effects. Used by both buildAnnualProjections (which sums
 * across streams) and buildRevenueStreamProjections (which exposes the
 * per-stream values). Sharing this formula guarantees the sum invariant.
 */
function computeStreamRevenueForYear(
  stream: RevenueStream,
  y: 1 | 2 | 3,
  loanImpact: SBAAssumptions["loanImpact"],
): number {
  const rates = [
    stream.growthRateYear1,
    stream.growthRateYear2,
    stream.growthRateYear3,
  ];
  let rev = stream.baseAnnualRevenue;
  for (let i = 0; i < y; i++) rev *= 1 + rates[i];

  if (loanImpact.revenueImpactPct && loanImpact.revenueImpactStartMonth) {
    if (y === 1) {
      const monthsInYear1 = Math.max(
        0,
        13 - loanImpact.revenueImpactStartMonth,
      );
      rev += rev * loanImpact.revenueImpactPct * (monthsInYear1 / 12);
    } else {
      rev *= 1 + loanImpact.revenueImpactPct;
    }
  }
  return rev;
}

/**
 * Per-stream Year 1–3 revenue projection. Each stream is compounded by
 * its own growth rates; consumers (renderer, narrative) display each
 * stream separately and the consolidated total comes from
 * buildAnnualProjections, which uses the same per-stream formula and
 * sums across streams.
 */
export function buildRevenueStreamProjections(
  assumptions: SBAAssumptions,
): RevenueStreamProjection[] {
  return assumptions.revenueStreams.map((stream) => ({
    id: stream.id,
    name: stream.name,
    pricingModel: stream.pricingModel,
    baseAnnualRevenue: stream.baseAnnualRevenue,
    growthRateYear1: stream.growthRateYear1,
    growthRateYear2: stream.growthRateYear2,
    growthRateYear3: stream.growthRateYear3,
    revenueYear1: computeStreamRevenueForYear(
      stream,
      1,
      assumptions.loanImpact,
    ),
    revenueYear2: computeStreamRevenueForYear(
      stream,
      2,
      assumptions.loanImpact,
    ),
    revenueYear3: computeStreamRevenueForYear(
      stream,
      3,
      assumptions.loanImpact,
    ),
  }));
}

/** Pass 2 + 3 + 4: annual projections Years 1–3 */
export function buildAnnualProjections(
  assumptions: SBAAssumptions,
  baseYear: AnnualProjectionYear,
  ledger: ProjectionLedger = buildProjectionLedger({ assumptions, baseYear }),
): AnnualProjectionYear[] {
  const years: AnnualProjectionYear[] = [];

  for (let y = 1; y <= 3; y++) {
    const prev = y === 1 ? baseYear : years[y - 2];

    // Revenue: compound each stream via the shared formula so per-stream
    // exposure (buildRevenueStreamProjections) and totals (here) cannot
    // drift.
    let revenue = 0;
    for (const stream of assumptions.revenueStreams) {
      revenue += computeStreamRevenueForYear(
        stream,
        y as 1 | 2 | 3,
        assumptions.loanImpact,
      );
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
      fixedCosts += fc.annualAmount * Math.pow(1 + fc.escalationPctPerYear, y - 1);
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

    const assetYear = ledger.assets[y - 1];
    const depreciation = assetYear.depreciation + assetYear.amortization;
    const ebit = ebitda - depreciation;
    const debt = debtYear(ledger, y);
    const totalDebtService = debt.payment;
    const interestExpense = debt.interest;
    const taxEstimate = Math.max(0, (ebit - interestExpense) * PROJECTION_TAX_RATE);
    const netIncome = ebit - interestExpense - taxEstimate;
    const dscr = finengineDscr(ebitda, totalDebtService).value ?? 99;

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
      interestExpense,
      taxEstimate,
      netIncome,
      totalDebtService,
      existingDebtService: debt.existingPayment,
      proposedLoanDebtService: debt.proposedPayment,
      sellerDebtService: debt.sellerPayment,
      principalRepayment: debt.principal,
      endingDebtBalance: debt.balance,
      dscr,
      revenueGrowthPct:
        prev.revenue > 0 ? (revenue - prev.revenue) / prev.revenue : 0,
    });
  }

  return years;
}

/** Pass 4 (continued): monthly CF for Year 1 */
/**
 * Year-1 monthly liquidity schedule.
 *
 * `openingCash` is the borrower's cash on hand at the start of the projection
 * period (the governed CASH fact). It seeds `cumulativeCash`, which is
 * therefore a CASH BALANCE, not a cumulative net change.
 *
 * That distinction was the defect. The series used to start at zero while two
 * consumers read it differently: buildBalanceSheetProjections added the
 * opening balance back (`bsBase.cash + year1EndingCash`), treating it as a
 * delta, while the business-plan renderer printed it verbatim as "a cumulative
 * cash position of $X" — a balance. For the QA fixture, whose governed CASH
 * fact is $240,000, that made ten of twelve months read negative and reported
 * a tightest-month cash position of about -$140,000 to a lender, for a
 * business that never drops below roughly +$100,000. The AI reviewer rejected
 * the resulting plan for exactly this: "The arithmetic is inconsistent."
 *
 * Seeding here makes one reading correct everywhere; callers must no longer
 * add the opening balance a second time.
 */
export function buildMonthlyProjections(
  assumptions: SBAAssumptions,
  year1: AnnualProjectionYear,
  useOfProceeds: UseOfProceedsLine[] = [],
  openingCash = 0,
  ledger: ProjectionLedger = buildProjectionLedger({ assumptions, useOfProceeds }),
): MonthlyProjection[] {
  const fixedMonthly = assumptions.costAssumptions.fixedCostCategories.reduce(
    (sum, item) => sum + item.annualAmount / 12,
    0,
  );
  const closingUses = ledger.closing.outflows + ledger.assets[0].capex - ledger.closing.fixedAssets;

  // A balance, seeded from cash on hand — see the contract above.
  let cumulativeCash = Number.isFinite(openingCash) ? openingCash : 0;
  let priorReceivables = ledger.opening?.accountsReceivable ?? 0;
  let priorPayables = ledger.opening?.accountsPayable ?? 0;
  // The closing inventory purchase is already a closing cash use.
  let priorInventory = (ledger.opening?.inventory ?? 0) + ledger.closing.inventory;
  return Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const revenue = assumptions.revenueStreams.reduce((sum, stream) => sum +
      computeStreamRevenueForYear(stream, 1, assumptions.loanImpact) / 12 * (stream.seasonalityProfile?.[i] ?? 1), 0);
    const cogs = revenue * assumptions.costAssumptions.cogsPercentYear1;
    const hireCost = assumptions.costAssumptions.plannedHires.reduce(
      (sum, hire) => sum + (m >= hire.startMonth ? hire.annualSalary / 12 : 0),
      0,
    );
    const taxPayments = year1.taxEstimate / 12;
    const operatingDisbursements = cogs + fixedMonthly + hireCost + taxPayments;
    // Use one day-count convention in both monthly and annual balances.
    const receivables = revenue * 12 / 365 * Math.max(0, assumptions.workingCapital.targetDSO);
    const payables = cogs * 12 / 365 * Math.max(0, assumptions.workingCapital.targetDPO);
    const inventory = assumptions.workingCapital.inventoryTurns && assumptions.workingCapital.inventoryTurns > 0
      ? (year1.cogs / assumptions.workingCapital.inventoryTurns)
      : (ledger.opening?.inventory ?? 0) + ledger.closing.inventory;
    const workingCapitalChange =
      (receivables - priorReceivables) + (inventory - priorInventory) - (payables - priorPayables);
    priorReceivables = receivables;
    priorPayables = payables;
    priorInventory = inventory;
    const netOperatingCF = revenue - operatingDisbursements - workingCapitalChange;
    const debtService = ledger.debt[i].payment;
    const financingInflows = m === 1 ? ledger.closing.inflows : 0;
    const capitalExpenditures = m === 1 ? closingUses : 0;
    const netCash =
      netOperatingCF - debtService + financingInflows - capitalExpenditures;
    cumulativeCash += netCash;
    return {
      month: m,
      revenue,
      operatingDisbursements,
      taxPayments,
      accountsReceivable: receivables,
      inventory,
      accountsPayable: payables,
      netOperatingCF,
      debtService,
      financingInflows,
      capitalExpenditures,
      workingCapitalChange,
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

/**
 * Three-scenario sensitivity.
 *
 * dscrThreshold: the DSCR floor a passing scenario must clear. Optional —
 * defaults to finengine's flat dscr_floor resolution (no productId/
 * new-business context) so existing callers that haven't been updated to
 * pass the real per-deal threshold (business age + SBA product tier — see
 * newBusinessProtocol.ts's assessNewBusinessRisk, the actual source of
 * truth) still resolve through the registry rather than a bare literal.
 */
export function buildSensitivityScenarios(
  assumptions: SBAAssumptions,
  baseProjections: AnnualProjectionYear[],
  dscrThreshold: number = resolvePolicy("dscr_floor").effective ?? 1.25,
  ledger?: ProjectionLedger,
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
    const adjYears = buildAnnualProjections(adj, anchor, ledger);

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
        (adjYears[0]?.dscr ?? 0) >= dscrThreshold &&
        (adjYears[1]?.dscr ?? 0) >= dscrThreshold &&
        (adjYears[2]?.dscr ?? 0) >= dscrThreshold,
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
