// src/lib/feasibility/types.ts
// Phase God Tier Feasibility — shared types used across every analysis,
// scorer, narrative, renderer, and orchestrator module. Pure types only.
// No runtime code. No server-only marker.

// ─── Scoring primitives ──────────────────────────────────────────────────

export interface DimensionScore {
  /** 0-100 score for the sub-dimension */
  score: number;
  /** 0-1 weight in the parent composite */
  weight: number;
  /** Where the data came from (for traceability in the PDF + UI) */
  dataSource: string;
  /** Was the input data actually available? Missing data ≠ failure */
  dataAvailable: boolean;
  /** Human-readable explanation of the score */
  detail: string;
}

export interface MarketFlag {
  severity: "info" | "warning" | "critical";
  dimension: string;
  message: string;
}

// ─── Tier 1 — Market Demand ──────────────────────────────────────────────

export interface MarketDemandScore {
  overallScore: number;
  populationAdequacy: DimensionScore;
  incomeAlignment: DimensionScore;
  competitiveDensity: DimensionScore;
  demandTrend: DimensionScore;
  dataCompleteness: number;
  flags: MarketFlag[];
}

export interface TradeAreaData {
  populationRadius5mi: number | null;
  populationRadius10mi: number | null;
  medianHouseholdIncome: number | null;
  populationGrowthRate5yr: number | null;
  competitorCount: number | null;
  totalBusinesses: number | null;
}

export interface FranchiseContext {
  brandName: string | null;
  systemAverageRevenue: number | null;
  systemMedianRevenue: number | null;
  existingUnitsInMarket: number | null;
  territoryExclusive: boolean | null;
  minimumPopulationRequired: number | null;
}

export interface MarketDemandInput {
  city: string | null;
  state: string | null;
  zipCode: string | null;
  naicsCode: string | null;
  naicsDescription: string | null;
  projectedAnnualRevenue: number | null;
  research: {
    marketIntelligence: string | null;
    competitiveLandscape: string | null;
    industryOverview: string | null;
    demographicTrends: string | null;
  };
  franchise: FranchiseContext | null;
  benchmark: import("@/lib/sba/sbaAssumptionBenchmarks").NAICSBenchmark | null;
  tradeArea: TradeAreaData | null;
}

// ─── Tier 1 — Financial Viability ────────────────────────────────────────

export interface FinancialViabilityScore {
  overallScore: number;
  debtServiceCoverage: DimensionScore;
  breakEvenMargin: DimensionScore;
  capitalizationAdequacy: DimensionScore;
  cashRunway: DimensionScore;
  downsideResilience: DimensionScore;
  dataCompleteness: number;
  flags: MarketFlag[];
}

export interface FinancialViabilityInput {
  dscrYear1Base: number | null;
  dscrYear2Base: number | null;
  dscrYear3Base: number | null;
  dscrYear1Downside: number | null;
  breakEvenRevenue: number | null;
  projectedRevenueYear1: number | null;
  marginOfSafetyPct: number | null;
  downsideDscrYear1: number | null;
  equityInjectionPct: number | null;
  totalProjectCost: number | null;
  workingCapitalReserveMonths: number | null;
  globalDscr: number | null;
  guarantorsWithNegativeCF: string[];
  currentRatioYear1: number | null;
  debtToEquityYear1: number | null;
  historicalRevenueGrowth: number | null;
  historicalEBITDAMargin: number | null;
  isNewBusiness: boolean;
  loanAmount: number;
  loanTermMonths: number;
}

// ─── Tier 1 — Operational Readiness ──────────────────────────────────────

export interface OperationalReadinessScore {
  overallScore: number;
  managementExperience: DimensionScore;
  industryKnowledge: DimensionScore;
  staffingReadiness: DimensionScore;
  franchiseSupport: DimensionScore;
  dataCompleteness: number;
  flags: MarketFlag[];
}

export interface ManagementMemberLite {
  name: string;
  title: string;
  ownershipPct: number;
  yearsInIndustry: number;
  bio: string;
}

export interface PlannedHireLite {
  role: string;
  startMonth: number;
  annualSalary: number;
}

export interface OperationalReadinessInput {
  managementTeam: ManagementMemberLite[];
  plannedHires: PlannedHireLite[];
  managementIntelligence: string | null;
  managementValidated: boolean;
  isFranchise: boolean;
  franchiseTrainingWeeks: number | null;
  franchiseOngoingSupport: string | null;
  franchiseOperationsManual: boolean | null;
}

// ─── Tier 1 — Location Suitability ───────────────────────────────────────

export interface LocationSuitabilityScore {
  overallScore: number;
  economicHealth: DimensionScore;
  realEstateMarket: DimensionScore;
  accessAndVisibility: DimensionScore;
  riskExposure: DimensionScore;
  dataCompleteness: number;
  flags: MarketFlag[];
}

export interface LocationTradeArea {
  unemploymentRate: number | null;
  medianHouseholdIncome: number | null;
  populationGrowthRate5yr: number | null;
  commercialVacancyRate: number | null;
  medianRentPsf: number | null;
}

export interface PropertyDetail {
  hasIdentifiedLocation: boolean;
  isLeaseNegotiated: boolean;
  monthlyRent: number | null;
  squareFootage: number | null;
  zonedCorrectly: boolean | null;
  parkingAdequate: boolean | null;
  trafficCountDaily: number | null;
}

export interface LocationSuitabilityInput {
  city: string | null;
  state: string | null;
  zipCode: string | null;
  research: {
    marketIntelligence: string | null;
    areaSpecificRisks: string | null;
    realEstateMarket: string | null;
    trendDirection: "improving" | "stable" | "deteriorating" | "unclear" | null;
  };
  tradeArea: LocationTradeArea | null;
  property: PropertyDetail | null;
}

// ─── Tier 2 — Composite scorer ───────────────────────────────────────────

export type FeasibilityRecommendation =
  | "Strongly Recommended"
  | "Recommended"
  | "Conditionally Feasible"
  | "Significant Concerns"
  | "Not Recommended";

export interface CompositeFeasibilityScore {
  overallScore: number;
  recommendation: FeasibilityRecommendation;
  confidenceLevel: "High" | "Moderate" | "Low";

  marketDemand: { score: number; weight: number };
  financialViability: { score: number; weight: number };
  operationalReadiness: { score: number; weight: number };
  locationSuitability: { score: number; weight: number };

  criticalFlags: number;
  warningFlags: number;
  infoFlags: number;
  allFlags: MarketFlag[];

  overallDataCompleteness: number;
  dimensionsMissingData: string[];
}

// ─── Tier 2 — Franchise comparator ───────────────────────────────────────

export interface FranchiseComparison {
  brandName: string;
  feasibilityScore: number;
  systemAverageRevenue: number | null;
  initialInvestmentLow: number | null;
  initialInvestmentHigh: number | null;
  royaltyPct: number | null;
  sbaCertified: boolean;
  matchReasons: string[];
  riskFactors: string[];
}

export interface ComparativeAnalysisResult {
  proposedBrand: FranchiseComparison | null;
  alternatives: FranchiseComparison[];
  proposedRank: number;
  betterAlternativeExists: boolean;
}

// ─── Tier 4 — Narratives ─────────────────────────────────────────────────

export interface FeasibilityNarratives {
  executiveSummary: string;
  marketDemandNarrative: string;
  financialViabilityNarrative: string;
  operationalReadinessNarrative: string;
  locationSuitabilityNarrative: string;
  riskAssessment: string;
  recommendation: string;
  franchiseComparisonNarrative: string | null;
}

// ─── Tier 4 — Engine result ─────────────────────────────────────────────

export interface FeasibilityResult {
  ok: boolean;
  error?: string;
  studyId?: string;
  composite?: CompositeFeasibilityScore;
  pdfUrl?: string;
}
