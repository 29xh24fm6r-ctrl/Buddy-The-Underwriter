// ─── Assumption Interview ─────────────────────────────────────────────────────

export type SeasonalityProfile = number[]; // 12 weights; must sum to 12

export interface RevenueStream {
  id: string;
  name: string;
  baseAnnualRevenue: number;
  growthRateYear1: number; // decimal, 0.12 = 12%
  growthRateYear2: number;
  growthRateYear3: number;
  pricingModel: "flat" | "per_unit" | "subscription" | "pct_revenue";
  seasonalityProfile: SeasonalityProfile | null; // null = flat monthly distribution
}

export interface PlannedHire {
  role: string;
  startMonth: number; // 1–36 relative to projection start
  annualSalary: number;
}

export interface PlannedCapex {
  description: string;
  amount: number;
  year: 1 | 2 | 3;
}

export interface FixedCostCategory {
  name: string;
  annualAmount: number;
  escalationPctPerYear: number; // 0.03 = 3%
}

export interface ExistingDebtItem {
  description: string;
  currentBalance: number;
  monthlyPayment: number;
  remainingTermMonths: number;
}

export interface ManagementMember {
  name: string;
  title: string;
  ownershipPct?: number;
  yearsInIndustry: number;
  bio: string; // 2 sentences minimum; required for Gemini narrative
}

export interface SBAAssumptions {
  dealId: string;
  status: "draft" | "complete" | "confirmed";
  confirmedAt?: string;

  // Section 1: Revenue (1–3 streams required)
  revenueStreams: RevenueStream[];

  // Section 2: Costs
  costAssumptions: {
    cogsPercentYear1: number;
    cogsPercentYear2: number;
    cogsPercentYear3: number;
    fixedCostCategories: FixedCostCategory[];
    plannedHires: PlannedHire[];
    plannedCapex: PlannedCapex[];
  };

  // Section 3: Working Capital
  workingCapital: {
    targetDSO: number;
    targetDPO: number;
    inventoryTurns: number | null;
  };

  // Section 4: Loan Impact (pre-filled from intake)
  loanImpact: {
    loanAmount: number;
    termMonths: number;
    interestRate: number; // decimal, 0.0725 = 7.25%
    existingDebt: ExistingDebtItem[];
    revenueImpactStartMonth?: number;
    revenueImpactPct?: number;
    revenueImpactDescription?: string;
    // Phase BPG — Sources of funds (equity injection + seller carry + other)
    equityInjectionAmount: number;
    equityInjectionSource:
      | "cash_savings"
      | "401k_rollover"
      | "gift"
      | "other";
    sellerFinancingAmount: number;
    sellerFinancingTermMonths: number;
    sellerFinancingRate: number;
    otherSources: Array<{ description: string; amount: number }>;
  };

  // Section 5: Management Team (1+ required)
  managementTeam: ManagementMember[];
}

// ─── Model Outputs ────────────────────────────────────────────────────────────

export interface AnnualProjectionYear {
  year: 0 | 1 | 2 | 3;
  label: "Actual" | "Projected";
  revenue: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number;
  operatingExpenses: number;
  ebitda: number;
  depreciation: number;
  ebit: number;
  interestExpense: number;
  taxEstimate: number;
  netIncome: number;
  totalDebtService: number;
  dscr: number;
  revenueGrowthPct?: number; // undefined for year 0
}

/**
 * Per-stream revenue projection. Each stream is compounded by its own
 * growth rates (RevenueStream.growthRateYearN), then summed across
 * streams to produce the consolidated revenue line in AnnualProjectionYear.
 *
 * Sum invariant: for any year y in {1,2,3},
 *   sum(p.revenueYearN for p in revenueStreamProjections) === annualProjections[y-1].revenue
 * (modulo proceeds-driven revenue uplift which is applied per-stream).
 */
export interface RevenueStreamProjection {
  id: string;
  name: string;
  pricingModel: RevenueStream["pricingModel"];
  baseAnnualRevenue: number;
  growthRateYear1: number;
  growthRateYear2: number;
  growthRateYear3: number;
  revenueYear1: number;
  revenueYear2: number;
  revenueYear3: number;
}

export interface MonthlyProjection {
  month: number; // 1–12
  revenue: number;
  operatingDisbursements: number;
  netOperatingCF: number;
  debtService: number;
  netCash: number;
  cumulativeCash: number;
}

export interface BreakEvenResult {
  fixedCostsAnnual: number;
  contributionMarginPct: number;
  breakEvenRevenue: number;
  breakEvenUnits: number | null;
  projectedRevenueYear1: number;
  marginOfSafetyPct: number;
  flagLowMargin: boolean; // true if marginOfSafetyPct < 0.10
}

export interface SensitivityScenario {
  name: "base" | "upside" | "downside";
  label: string;
  revenueGrowthAdjustment: number;
  cogsAdjustment: number;
  dscrYear1: number;
  dscrYear2: number;
  dscrYear3: number;
  revenueYear1: number;
  ebitdaMarginYear1: number;
  passesSBAThreshold: boolean; // all years >= 1.25
}

export interface UseOfProceedsLine {
  category: string;
  description: string;
  amount: number;
  pctOfTotal: number;
}

export interface SBAPackageData {
  dealId: string;
  assumptionsId: string;
  generatedAt: string;
  baseYearData: AnnualProjectionYear;
  projectionsAnnual: AnnualProjectionYear[];
  projectionsMonthly: MonthlyProjection[];
  /**
   * Per-stream Y1–3 revenue. Optional because the DB column is jsonb
   * scoped to totals — readers that need per-stream data should call
   * buildRevenueStreamProjections(assumptions) on demand.
   */
  revenueStreamProjections?: RevenueStreamProjection[];
  breakEven: BreakEvenResult;
  sensitivityScenarios: SensitivityScenario[];
  useOfProceeds: UseOfProceedsLine[];
  dscrYear1Base: number;
  dscrYear2Base: number;
  dscrYear3Base: number;
  dscrYear1Downside: number;
  dscrBelowThreshold: boolean;
  businessOverviewNarrative: string;
  sensitivityNarrative: string;
  pdfUrl?: string;
  status: "draft" | "reviewed" | "submitted";
}

export type PreflightResult =
  | { ok: true }
  | { ok: false; blockers: string[] };

// ─── API Response Shapes ──────────────────────────────────────────────────────

export interface GetAssumptionsResponse {
  assumptions: SBAAssumptions | null;
  prefilled: Partial<SBAAssumptions>;
}

export interface SaveAssumptionsBody {
  patch: Partial<SBAAssumptions>;
}

export interface GeneratePackageResponse {
  ok: boolean;
  packageId?: string;
  dscrBelowThreshold?: boolean;
  dscrYear1Base?: number;
  pdfUrl?: string;
  error?: string;
  blockers?: string[];
}

export interface GetLatestPackageResponse {
  package: SBAPackageData | null;
}

// ─── Phase 2 — Smart prefill metadata ────────────────────────────────────────

export interface PrefillMeta {
  naicsCode: string | null;
  naicsLabel: string | null;
  industryLabel: string | null;
  benchmarkApplied: boolean;
}

// ─── Phase BPG — Re-exports for business-plan sub-modules ────────────────────
// Consumer components can import these contract types from a single entrypoint.

export type { BalanceSheetYear } from "./sbaBalanceSheetProjector";
export type {
  GuarantorCashFlow,
  GlobalCashFlowResult,
} from "./sbaGlobalCashFlow";
export type {
  SourcesAndUsesResult,
  SourceLine,
  UseLine,
  EquityInjectionCheck,
  EquityInjectionSource,
} from "./sbaSourcesAndUses";
export type { BenchmarkWarning } from "./sbaAssumptionBenchmarks";
export type { CoachingTip } from "./sbaAssumptionCoach";
