/**
 * Industry Benchmarks — God Tier Phase 2D, Layer 6
 *
 * NAICS-level peer comparison for every ratio.
 * Seeded with RMA-equivalent benchmark data for the 50 most common
 * NAICS codes in commercial lending across 5 revenue tiers.
 *
 * Pure function — no DB, no server imports.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RevenueTier =
  | "under_1m"
  | "1m_5m"
  | "5m_25m"
  | "25m_100m"
  | "over_100m";

export type BenchmarkAssessment = "strong" | "adequate" | "weak" | "concerning";

export type Percentiles = {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
};

export type RatioBenchmarkOutput = {
  value: number;
  canonicalKey: string;
  industryNaics: string;
  naicsDescription: string;
  revenueTier: RevenueTier;
  percentile: number;
  assessment: BenchmarkAssessment;
  peerMedian: number;
  peerP25: number;
  peerP75: number;
  narrative: string;
};

export type BenchmarkLookupResult = {
  percentiles: Percentiles;
  naicsDescription: string;
  revenueTier: RevenueTier;
} | null;

// ---------------------------------------------------------------------------
// Benchmark metric IDs (subset of metric registry IDs that are benchmarkable)
// ---------------------------------------------------------------------------

export const BENCHMARK_METRIC_IDS = [
  "GROSS_MARGIN",
  "EBITDA_MARGIN",
  "NET_MARGIN",
  "CURRENT_RATIO",
  "QUICK_RATIO",
  "DEBT_TO_EQUITY",
  "DSCR",
  "DSO",
  "DIO",
  "DPO",
  "INVENTORY_TURNOVER",
  "DEBT_TO_EBITDA",
  "ROA",
  "ROE",
  "INTEREST_COVERAGE",
] as const;

export type BenchmarkMetricId = (typeof BENCHMARK_METRIC_IDS)[number];

/** Metrics where lower values indicate better performance. */
const LOWER_IS_BETTER = new Set<BenchmarkMetricId>([
  "DEBT_TO_EQUITY",
  "DSO",
  "DIO",
  "DPO",
  "DEBT_TO_EBITDA",
]);

// ---------------------------------------------------------------------------
// Industry groups
// ---------------------------------------------------------------------------

type IndustryGroup =
  | "manufacturing"
  | "wholesale"
  | "retail"
  | "professional_services"
  | "healthcare"
  | "construction"
  | "real_estate"
  | "food_service"
  | "transportation"
  | "other_services"
  | "agriculture"
  | "finance_insurance";

type BenchmarkProfile = Partial<Record<BenchmarkMetricId, Percentiles>>;

// ---------------------------------------------------------------------------
// Base profiles by industry group (median revenue tier: $5M–$25M)
// ---------------------------------------------------------------------------

const BASE_PROFILES: Record<IndustryGroup, BenchmarkProfile> = {
  manufacturing: {
    GROSS_MARGIN:       { p25: 0.20, p50: 0.30, p75: 0.40, p90: 0.50 },
    EBITDA_MARGIN:      { p25: 0.05, p50: 0.10, p75: 0.16, p90: 0.22 },
    NET_MARGIN:         { p25: 0.01, p50: 0.04, p75: 0.08, p90: 0.14 },
    CURRENT_RATIO:      { p25: 1.1,  p50: 1.6,  p75: 2.4,  p90: 3.5 },
    QUICK_RATIO:        { p25: 0.5,  p50: 0.9,  p75: 1.4,  p90: 2.1 },
    DEBT_TO_EQUITY:     { p25: 0.4,  p50: 1.2,  p75: 2.8,  p90: 5.5 },
    DSCR:               { p25: 0.9,  p50: 1.4,  p75: 2.1,  p90: 3.2 },
    DSO:                { p25: 25,   p50: 38,   p75: 52,   p90: 70 },
    DIO:                { p25: 22,   p50: 45,   p75: 75,   p90: 115 },
    DPO:                { p25: 15,   p50: 28,   p75: 42,   p90: 60 },
    INVENTORY_TURNOVER: { p25: 3.5,  p50: 6.0,  p75: 10.5, p90: 17.0 },
    DEBT_TO_EBITDA:     { p25: 1.0,  p50: 2.5,  p75: 4.5,  p90: 7.5 },
    ROA:                { p25: 0.01, p50: 0.06, p75: 0.12, p90: 0.20 },
    ROE:                { p25: 0.03, p50: 0.14, p75: 0.28, p90: 0.45 },
    INTEREST_COVERAGE:  { p25: 1.5,  p50: 4.0,  p75: 8.0,  p90: 16.0 },
  },
  wholesale: {
    GROSS_MARGIN:       { p25: 0.14, p50: 0.22, p75: 0.30, p90: 0.38 },
    EBITDA_MARGIN:      { p25: 0.02, p50: 0.04, p75: 0.07, p90: 0.11 },
    NET_MARGIN:         { p25: 0.005,p50: 0.02, p75: 0.04, p90: 0.07 },
    CURRENT_RATIO:      { p25: 1.1,  p50: 1.4,  p75: 2.0,  p90: 3.0 },
    QUICK_RATIO:        { p25: 0.6,  p50: 0.9,  p75: 1.3,  p90: 1.9 },
    DEBT_TO_EQUITY:     { p25: 0.5,  p50: 1.4,  p75: 3.0,  p90: 6.0 },
    DSCR:               { p25: 0.8,  p50: 1.2,  p75: 1.8,  p90: 2.8 },
    DSO:                { p25: 22,   p50: 35,   p75: 48,   p90: 62 },
    DIO:                { p25: 18,   p50: 32,   p75: 52,   p90: 80 },
    DPO:                { p25: 12,   p50: 25,   p75: 38,   p90: 55 },
    INVENTORY_TURNOVER: { p25: 5.0,  p50: 8.0,  p75: 13.0, p90: 20.0 },
    DEBT_TO_EBITDA:     { p25: 1.5,  p50: 3.0,  p75: 5.5,  p90: 9.0 },
    ROA:                { p25: 0.01, p50: 0.05, p75: 0.10, p90: 0.16 },
    ROE:                { p25: 0.04, p50: 0.15, p75: 0.30, p90: 0.50 },
    INTEREST_COVERAGE:  { p25: 1.2,  p50: 3.0,  p75: 6.5,  p90: 14.0 },
  },
  retail: {
    GROSS_MARGIN:       { p25: 0.22, p50: 0.32, p75: 0.42, p90: 0.52 },
    EBITDA_MARGIN:      { p25: 0.03, p50: 0.06, p75: 0.10, p90: 0.15 },
    NET_MARGIN:         { p25: 0.01, p50: 0.03, p75: 0.06, p90: 0.10 },
    CURRENT_RATIO:      { p25: 1.0,  p50: 1.5,  p75: 2.2,  p90: 3.2 },
    QUICK_RATIO:        { p25: 0.3,  p50: 0.6,  p75: 1.0,  p90: 1.6 },
    DEBT_TO_EQUITY:     { p25: 0.5,  p50: 1.5,  p75: 3.2,  p90: 6.5 },
    DSCR:               { p25: 0.8,  p50: 1.3,  p75: 1.9,  p90: 2.8 },
    DSO:                { p25: 5,    p50: 12,   p75: 22,   p90: 35 },
    DIO:                { p25: 30,   p50: 55,   p75: 85,   p90: 125 },
    DPO:                { p25: 10,   p50: 22,   p75: 38,   p90: 58 },
    INVENTORY_TURNOVER: { p25: 3.0,  p50: 5.5,  p75: 9.0,  p90: 14.0 },
    DEBT_TO_EBITDA:     { p25: 1.2,  p50: 3.0,  p75: 5.0,  p90: 8.5 },
    ROA:                { p25: 0.01, p50: 0.05, p75: 0.10, p90: 0.18 },
    ROE:                { p25: 0.03, p50: 0.12, p75: 0.25, p90: 0.42 },
    INTEREST_COVERAGE:  { p25: 1.2,  p50: 3.5,  p75: 7.0,  p90: 14.0 },
  },
  professional_services: {
    GROSS_MARGIN:       { p25: 0.40, p50: 0.55, p75: 0.68, p90: 0.80 },
    EBITDA_MARGIN:      { p25: 0.08, p50: 0.18, p75: 0.28, p90: 0.40 },
    NET_MARGIN:         { p25: 0.03, p50: 0.10, p75: 0.18, p90: 0.28 },
    CURRENT_RATIO:      { p25: 1.0,  p50: 1.4,  p75: 2.2,  p90: 3.5 },
    QUICK_RATIO:        { p25: 0.8,  p50: 1.2,  p75: 2.0,  p90: 3.2 },
    DEBT_TO_EQUITY:     { p25: 0.3,  p50: 0.8,  p75: 2.0,  p90: 4.5 },
    DSCR:               { p25: 1.0,  p50: 1.6,  p75: 2.5,  p90: 4.0 },
    DSO:                { p25: 20,   p50: 35,   p75: 55,   p90: 75 },
    DEBT_TO_EBITDA:     { p25: 0.5,  p50: 1.5,  p75: 3.0,  p90: 5.5 },
    ROA:                { p25: 0.02, p50: 0.08, p75: 0.16, p90: 0.28 },
    ROE:                { p25: 0.05, p50: 0.20, p75: 0.35, p90: 0.55 },
    INTEREST_COVERAGE:  { p25: 2.0,  p50: 5.0,  p75: 12.0, p90: 25.0 },
  },
  healthcare: {
    GROSS_MARGIN:       { p25: 0.35, p50: 0.48, p75: 0.60, p90: 0.72 },
    EBITDA_MARGIN:      { p25: 0.08, p50: 0.16, p75: 0.25, p90: 0.35 },
    NET_MARGIN:         { p25: 0.03, p50: 0.08, p75: 0.15, p90: 0.25 },
    CURRENT_RATIO:      { p25: 1.1,  p50: 1.6,  p75: 2.5,  p90: 4.0 },
    QUICK_RATIO:        { p25: 0.8,  p50: 1.3,  p75: 2.2,  p90: 3.5 },
    DEBT_TO_EQUITY:     { p25: 0.3,  p50: 0.9,  p75: 2.2,  p90: 5.0 },
    DSCR:               { p25: 1.0,  p50: 1.5,  p75: 2.5,  p90: 4.0 },
    DSO:                { p25: 15,   p50: 30,   p75: 50,   p90: 72 },
    DEBT_TO_EBITDA:     { p25: 0.5,  p50: 1.5,  p75: 3.5,  p90: 6.0 },
    ROA:                { p25: 0.02, p50: 0.08, p75: 0.18, p90: 0.30 },
    ROE:                { p25: 0.05, p50: 0.18, p75: 0.35, p90: 0.55 },
    INTEREST_COVERAGE:  { p25: 2.0,  p50: 5.5,  p75: 12.0, p90: 22.0 },
  },
  construction: {
    GROSS_MARGIN:       { p25: 0.15, p50: 0.22, p75: 0.30, p90: 0.38 },
    EBITDA_MARGIN:      { p25: 0.03, p50: 0.07, p75: 0.12, p90: 0.18 },
    NET_MARGIN:         { p25: 0.01, p50: 0.03, p75: 0.07, p90: 0.12 },
    CURRENT_RATIO:      { p25: 1.1,  p50: 1.5,  p75: 2.1,  p90: 3.0 },
    QUICK_RATIO:        { p25: 0.8,  p50: 1.2,  p75: 1.8,  p90: 2.6 },
    DEBT_TO_EQUITY:     { p25: 0.6,  p50: 1.5,  p75: 3.5,  p90: 7.0 },
    DSCR:               { p25: 0.8,  p50: 1.2,  p75: 1.8,  p90: 2.8 },
    DSO:                { p25: 30,   p50: 50,   p75: 72,   p90: 95 },
    DIO:                { p25: 5,    p50: 12,   p75: 25,   p90: 42 },
    DPO:                { p25: 15,   p50: 30,   p75: 50,   p90: 72 },
    INVENTORY_TURNOVER: { p25: 8.0,  p50: 15.0, p75: 28.0, p90: 50.0 },
    DEBT_TO_EBITDA:     { p25: 1.5,  p50: 3.0,  p75: 6.0,  p90: 10.0 },
    ROA:                { p25: 0.01, p50: 0.05, p75: 0.10, p90: 0.18 },
    ROE:                { p25: 0.04, p50: 0.14, p75: 0.28, p90: 0.48 },
    INTEREST_COVERAGE:  { p25: 1.2,  p50: 3.0,  p75: 6.0,  p90: 12.0 },
  },
  real_estate: {
    GROSS_MARGIN:       { p25: 0.25, p50: 0.40, p75: 0.55, p90: 0.68 },
    EBITDA_MARGIN:      { p25: 0.15, p50: 0.30, p75: 0.45, p90: 0.58 },
    NET_MARGIN:         { p25: 0.05, p50: 0.15, p75: 0.28, p90: 0.40 },
    CURRENT_RATIO:      { p25: 0.8,  p50: 1.2,  p75: 1.8,  p90: 2.8 },
    QUICK_RATIO:        { p25: 0.6,  p50: 1.0,  p75: 1.6,  p90: 2.5 },
    DEBT_TO_EQUITY:     { p25: 1.0,  p50: 2.5,  p75: 5.0,  p90: 10.0 },
    DSCR:               { p25: 1.0,  p50: 1.3,  p75: 1.8,  p90: 2.5 },
    DSO:                { p25: 10,   p50: 22,   p75: 40,   p90: 60 },
    DEBT_TO_EBITDA:     { p25: 2.0,  p50: 4.0,  p75: 7.0,  p90: 12.0 },
    ROA:                { p25: 0.01, p50: 0.03, p75: 0.06, p90: 0.10 },
    ROE:                { p25: 0.02, p50: 0.08, p75: 0.15, p90: 0.25 },
    INTEREST_COVERAGE:  { p25: 1.0,  p50: 2.0,  p75: 3.5,  p90: 6.0 },
  },
  food_service: {
    GROSS_MARGIN:       { p25: 0.50, p50: 0.60, p75: 0.68, p90: 0.75 },
    EBITDA_MARGIN:      { p25: 0.03, p50: 0.08, p75: 0.14, p90: 0.20 },
    NET_MARGIN:         { p25: 0.01, p50: 0.04, p75: 0.08, p90: 0.14 },
    CURRENT_RATIO:      { p25: 0.6,  p50: 0.9,  p75: 1.4,  p90: 2.2 },
    QUICK_RATIO:        { p25: 0.3,  p50: 0.6,  p75: 1.0,  p90: 1.6 },
    DEBT_TO_EQUITY:     { p25: 0.8,  p50: 2.0,  p75: 4.5,  p90: 9.0 },
    DSCR:               { p25: 0.7,  p50: 1.1,  p75: 1.7,  p90: 2.5 },
    DSO:                { p25: 3,    p50: 8,    p75: 15,   p90: 25 },
    DIO:                { p25: 3,    p50: 7,    p75: 12,   p90: 20 },
    DPO:                { p25: 8,    p50: 18,   p75: 30,   p90: 45 },
    INVENTORY_TURNOVER: { p25: 15.0, p50: 25.0, p75: 40.0, p90: 60.0 },
    DEBT_TO_EBITDA:     { p25: 2.0,  p50: 4.0,  p75: 7.0,  p90: 12.0 },
    ROA:                { p25: 0.01, p50: 0.04, p75: 0.10, p90: 0.18 },
    ROE:                { p25: 0.02, p50: 0.10, p75: 0.22, p90: 0.38 },
    INTEREST_COVERAGE:  { p25: 1.0,  p50: 2.5,  p75: 5.0,  p90: 10.0 },
  },
  transportation: {
    GROSS_MARGIN:       { p25: 0.20, p50: 0.30, p75: 0.40, p90: 0.50 },
    EBITDA_MARGIN:      { p25: 0.05, p50: 0.10, p75: 0.16, p90: 0.22 },
    NET_MARGIN:         { p25: 0.01, p50: 0.04, p75: 0.08, p90: 0.14 },
    CURRENT_RATIO:      { p25: 0.9,  p50: 1.3,  p75: 1.9,  p90: 2.8 },
    QUICK_RATIO:        { p25: 0.6,  p50: 1.0,  p75: 1.5,  p90: 2.2 },
    DEBT_TO_EQUITY:     { p25: 0.6,  p50: 1.5,  p75: 3.5,  p90: 7.0 },
    DSCR:               { p25: 0.8,  p50: 1.2,  p75: 1.8,  p90: 2.8 },
    DSO:                { p25: 22,   p50: 38,   p75: 55,   p90: 75 },
    DEBT_TO_EBITDA:     { p25: 1.5,  p50: 3.0,  p75: 5.5,  p90: 9.0 },
    ROA:                { p25: 0.01, p50: 0.05, p75: 0.10, p90: 0.18 },
    ROE:                { p25: 0.03, p50: 0.12, p75: 0.25, p90: 0.42 },
    INTEREST_COVERAGE:  { p25: 1.2,  p50: 3.0,  p75: 6.0,  p90: 12.0 },
  },
  other_services: {
    GROSS_MARGIN:       { p25: 0.30, p50: 0.42, p75: 0.55, p90: 0.68 },
    EBITDA_MARGIN:      { p25: 0.05, p50: 0.12, p75: 0.20, p90: 0.30 },
    NET_MARGIN:         { p25: 0.02, p50: 0.06, p75: 0.12, p90: 0.20 },
    CURRENT_RATIO:      { p25: 0.9,  p50: 1.3,  p75: 2.0,  p90: 3.0 },
    QUICK_RATIO:        { p25: 0.6,  p50: 1.0,  p75: 1.6,  p90: 2.5 },
    DEBT_TO_EQUITY:     { p25: 0.4,  p50: 1.2,  p75: 2.8,  p90: 5.5 },
    DSCR:               { p25: 0.9,  p50: 1.3,  p75: 2.0,  p90: 3.0 },
    DSO:                { p25: 15,   p50: 28,   p75: 45,   p90: 65 },
    DEBT_TO_EBITDA:     { p25: 1.0,  p50: 2.5,  p75: 4.5,  p90: 8.0 },
    ROA:                { p25: 0.02, p50: 0.06, p75: 0.14, p90: 0.24 },
    ROE:                { p25: 0.04, p50: 0.15, p75: 0.30, p90: 0.48 },
    INTEREST_COVERAGE:  { p25: 1.5,  p50: 3.5,  p75: 8.0,  p90: 16.0 },
  },
  agriculture: {
    GROSS_MARGIN:       { p25: 0.12, p50: 0.20, p75: 0.30, p90: 0.42 },
    EBITDA_MARGIN:      { p25: 0.05, p50: 0.12, p75: 0.20, p90: 0.30 },
    NET_MARGIN:         { p25: 0.01, p50: 0.05, p75: 0.10, p90: 0.18 },
    CURRENT_RATIO:      { p25: 0.9,  p50: 1.3,  p75: 2.0,  p90: 3.0 },
    QUICK_RATIO:        { p25: 0.4,  p50: 0.7,  p75: 1.2,  p90: 1.8 },
    DEBT_TO_EQUITY:     { p25: 0.5,  p50: 1.5,  p75: 3.5,  p90: 8.0 },
    DSCR:               { p25: 0.7,  p50: 1.1,  p75: 1.6,  p90: 2.4 },
    DSO:                { p25: 10,   p50: 22,   p75: 40,   p90: 60 },
    DIO:                { p25: 20,   p50: 40,   p75: 70,   p90: 110 },
    DPO:                { p25: 10,   p50: 22,   p75: 38,   p90: 55 },
    INVENTORY_TURNOVER: { p25: 3.0,  p50: 6.0,  p75: 10.0, p90: 16.0 },
    DEBT_TO_EBITDA:     { p25: 2.0,  p50: 4.0,  p75: 7.0,  p90: 12.0 },
    ROA:                { p25: 0.01, p50: 0.03, p75: 0.07, p90: 0.12 },
    ROE:                { p25: 0.02, p50: 0.06, p75: 0.14, p90: 0.24 },
    INTEREST_COVERAGE:  { p25: 1.0,  p50: 2.0,  p75: 4.0,  p90: 8.0 },
  },
  finance_insurance: {
    GROSS_MARGIN:       { p25: 0.35, p50: 0.50, p75: 0.65, p90: 0.78 },
    EBITDA_MARGIN:      { p25: 0.10, p50: 0.20, p75: 0.32, p90: 0.45 },
    NET_MARGIN:         { p25: 0.05, p50: 0.12, p75: 0.22, p90: 0.32 },
    CURRENT_RATIO:      { p25: 1.0,  p50: 1.5,  p75: 2.2,  p90: 3.5 },
    QUICK_RATIO:        { p25: 0.8,  p50: 1.3,  p75: 2.0,  p90: 3.2 },
    DEBT_TO_EQUITY:     { p25: 0.3,  p50: 0.8,  p75: 2.0,  p90: 4.0 },
    DSCR:               { p25: 1.1,  p50: 1.6,  p75: 2.5,  p90: 4.0 },
    DSO:                { p25: 18,   p50: 32,   p75: 50,   p90: 70 },
    DEBT_TO_EBITDA:     { p25: 0.5,  p50: 1.5,  p75: 3.0,  p90: 5.0 },
    ROA:                { p25: 0.02, p50: 0.06, p75: 0.12, p90: 0.20 },
    ROE:                { p25: 0.05, p50: 0.15, p75: 0.28, p90: 0.45 },
    INTEREST_COVERAGE:  { p25: 2.5,  p50: 6.0,  p75: 14.0, p90: 28.0 },
  },
};

// ---------------------------------------------------------------------------
// Revenue tier adjustment multipliers
//
// Larger companies tend to have better margins, liquidity, and coverage.
// Multiplier is applied to the base profile values.
// For "lower is better" metrics, the relationship is inverted internally.
// ---------------------------------------------------------------------------

type TierMultipliers = Partial<Record<BenchmarkMetricId, number>>;

const TIER_ADJUSTMENTS: Record<RevenueTier, TierMultipliers> = {
  under_1m: {
    GROSS_MARGIN: 0.88, EBITDA_MARGIN: 0.80, NET_MARGIN: 0.75,
    CURRENT_RATIO: 0.85, QUICK_RATIO: 0.82,
    DEBT_TO_EQUITY: 1.25, DSCR: 0.82,
    DSO: 1.15, DIO: 1.10, DPO: 1.10,
    INVENTORY_TURNOVER: 0.85, DEBT_TO_EBITDA: 1.20,
    ROA: 0.80, ROE: 0.80, INTEREST_COVERAGE: 0.75,
  },
  "1m_5m": {
    GROSS_MARGIN: 0.95, EBITDA_MARGIN: 0.92, NET_MARGIN: 0.90,
    CURRENT_RATIO: 0.95, QUICK_RATIO: 0.92,
    DEBT_TO_EQUITY: 1.10, DSCR: 0.92,
    DSO: 1.05, DIO: 1.05, DPO: 1.05,
    INVENTORY_TURNOVER: 0.95, DEBT_TO_EBITDA: 1.08,
    ROA: 0.92, ROE: 0.92, INTEREST_COVERAGE: 0.90,
  },
  "5m_25m": {
    // Base tier — no adjustments
  },
  "25m_100m": {
    GROSS_MARGIN: 1.05, EBITDA_MARGIN: 1.08, NET_MARGIN: 1.10,
    CURRENT_RATIO: 1.05, QUICK_RATIO: 1.08,
    DEBT_TO_EQUITY: 0.92, DSCR: 1.08,
    DSO: 0.95, DIO: 0.95, DPO: 0.95,
    INVENTORY_TURNOVER: 1.08, DEBT_TO_EBITDA: 0.92,
    ROA: 1.06, ROE: 1.06, INTEREST_COVERAGE: 1.10,
  },
  over_100m: {
    GROSS_MARGIN: 1.08, EBITDA_MARGIN: 1.15, NET_MARGIN: 1.18,
    CURRENT_RATIO: 1.10, QUICK_RATIO: 1.12,
    DEBT_TO_EQUITY: 0.85, DSCR: 1.15,
    DSO: 0.90, DIO: 0.88, DPO: 0.90,
    INVENTORY_TURNOVER: 1.15, DEBT_TO_EBITDA: 0.85,
    ROA: 1.10, ROE: 1.10, INTEREST_COVERAGE: 1.20,
  },
};

// ---------------------------------------------------------------------------
// NAICS → industry group mapping (50 most common in commercial lending)
// ---------------------------------------------------------------------------

type NaicsEntry = {
  group: IndustryGroup;
  description: string;
  overrides?: Partial<Record<BenchmarkMetricId, Percentiles>>;
};

const NAICS_CATALOG: Record<string, NaicsEntry> = {
  // Construction (NAICS 23)
  "236115": { group: "construction", description: "New single-family housing construction" },
  "236116": { group: "construction", description: "New multifamily housing construction" },
  "236220": { group: "construction", description: "Commercial and institutional building construction" },
  "238210": { group: "construction", description: "Electrical contractors" },
  "238220": { group: "construction", description: "Plumbing, heating, and AC contractors" },
  "238910": { group: "construction", description: "Site preparation contractors" },
  // Manufacturing (NAICS 31–33)
  "311812": { group: "manufacturing", description: "Commercial bakeries",
    overrides: { GROSS_MARGIN: { p25: 0.28, p50: 0.38, p75: 0.48, p90: 0.58 } } },
  "332710": { group: "manufacturing", description: "Machine shops" },
  "333249": { group: "manufacturing", description: "Other industrial machinery manufacturing" },
  "336111": { group: "manufacturing", description: "Automobile manufacturing",
    overrides: { DIO: { p25: 30, p50: 55, p75: 90, p90: 140 } } },
  "339112": { group: "manufacturing", description: "Surgical and medical instrument manufacturing",
    overrides: { GROSS_MARGIN: { p25: 0.35, p50: 0.48, p75: 0.60, p90: 0.72 } } },
  // Wholesale (NAICS 42)
  "423110": { group: "wholesale", description: "Automobile and other motor vehicle merchant wholesalers" },
  "423300": { group: "wholesale", description: "Lumber and other construction materials merchant wholesalers" },
  "423400": { group: "wholesale", description: "Professional and commercial equipment merchant wholesalers" },
  "424410": { group: "wholesale", description: "General line grocery merchant wholesalers",
    overrides: { GROSS_MARGIN: { p25: 0.08, p50: 0.14, p75: 0.20, p90: 0.26 } } },
  "424490": { group: "wholesale", description: "Other grocery and related products merchant wholesalers" },
  // Retail (NAICS 44–45)
  "441110": { group: "retail", description: "New car dealers",
    overrides: { GROSS_MARGIN: { p25: 0.12, p50: 0.16, p75: 0.20, p90: 0.24 } } },
  "442110": { group: "retail", description: "Furniture stores" },
  "444110": { group: "retail", description: "Home centers" },
  "445110": { group: "retail", description: "Supermarkets and other grocery stores",
    overrides: { GROSS_MARGIN: { p25: 0.22, p50: 0.28, p75: 0.34, p90: 0.40 }, INVENTORY_TURNOVER: { p25: 10.0, p50: 15.0, p75: 22.0, p90: 30.0 } } },
  "447110": { group: "retail", description: "Gasoline stations with convenience stores",
    overrides: { GROSS_MARGIN: { p25: 0.15, p50: 0.22, p75: 0.30, p90: 0.38 } } },
  // Transportation (NAICS 48–49)
  "484110": { group: "transportation", description: "General freight trucking, local" },
  "484121": { group: "transportation", description: "General freight trucking, long-distance, truckload" },
  "488510": { group: "transportation", description: "Freight transportation arrangement" },
  // Real Estate (NAICS 53)
  "531110": { group: "real_estate", description: "Lessors of residential buildings and dwellings" },
  "531120": { group: "real_estate", description: "Lessors of nonresidential buildings" },
  "531210": { group: "real_estate", description: "Offices of real estate agents and brokers" },
  "531312": { group: "real_estate", description: "Nonresidential property managers" },
  // Professional Services (NAICS 54)
  "541110": { group: "professional_services", description: "Offices of lawyers" },
  "541211": { group: "professional_services", description: "Offices of certified public accountants" },
  "541330": { group: "professional_services", description: "Engineering services" },
  "541511": { group: "professional_services", description: "Custom computer programming services" },
  "541512": { group: "professional_services", description: "Computer systems design services" },
  "541611": { group: "professional_services", description: "Administrative management and general management consulting" },
  "541810": { group: "professional_services", description: "Advertising agencies" },
  // Healthcare (NAICS 62)
  "621111": { group: "healthcare", description: "Offices of physicians (except mental health specialists)" },
  "621210": { group: "healthcare", description: "Offices of dentists" },
  "621310": { group: "healthcare", description: "Offices of chiropractors" },
  "623110": { group: "healthcare", description: "Nursing care facilities (skilled nursing facilities)",
    overrides: { GROSS_MARGIN: { p25: 0.15, p50: 0.22, p75: 0.30, p90: 0.38 } } },
  // Accommodation & Food Service (NAICS 72)
  "721110": { group: "food_service", description: "Hotels (except casino hotels) and motels",
    overrides: { GROSS_MARGIN: { p25: 0.30, p50: 0.42, p75: 0.55, p90: 0.65 } } },
  "722511": { group: "food_service", description: "Full-service restaurants" },
  "722513": { group: "food_service", description: "Limited-service restaurants" },
  "722515": { group: "food_service", description: "Snack and nonalcoholic beverage bars" },
  // Other Services (NAICS 56, 81, 812)
  "561720": { group: "other_services", description: "Janitorial services" },
  "811111": { group: "other_services", description: "General automotive repair" },
  "812111": { group: "other_services", description: "Barber shops" },
  "812112": { group: "other_services", description: "Beauty salons" },
  // Agriculture (NAICS 11)
  "111998": { group: "agriculture", description: "All other miscellaneous crop farming" },
  // Finance & Insurance (NAICS 52, 524)
  "522110": { group: "finance_insurance", description: "Commercial banking" },
  "524210": { group: "finance_insurance", description: "Insurance agencies and brokerages" },
};

// ---------------------------------------------------------------------------
// Revenue tier resolver
// ---------------------------------------------------------------------------

export function getRevenueTier(annualRevenue: number): RevenueTier {
  if (annualRevenue < 1_000_000) return "under_1m";
  if (annualRevenue < 5_000_000) return "1m_5m";
  if (annualRevenue < 25_000_000) return "5m_25m";
  if (annualRevenue < 100_000_000) return "25m_100m";
  return "over_100m";
}

// ---------------------------------------------------------------------------
// NAICS resolution — supports exact code, 4-digit prefix, 2-digit prefix
// ---------------------------------------------------------------------------

function resolveNaics(naicsCode: string): NaicsEntry | null {
  // Exact match
  if (NAICS_CATALOG[naicsCode]) return NAICS_CATALOG[naicsCode];
  // Try 4-digit prefix
  const prefix4 = naicsCode.slice(0, 4);
  for (const [code, entry] of Object.entries(NAICS_CATALOG)) {
    if (code.startsWith(prefix4)) return entry;
  }
  // Try 2-digit prefix → industry group
  const prefix2 = naicsCode.slice(0, 2);
  for (const [code, entry] of Object.entries(NAICS_CATALOG)) {
    if (code.startsWith(prefix2)) return entry;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Benchmark lookup — resolve NAICS + tier → percentiles for a metric
// ---------------------------------------------------------------------------

export function lookupBenchmark(
  naicsCode: string,
  metricId: BenchmarkMetricId,
  annualRevenue: number,
): BenchmarkLookupResult {
  const entry = resolveNaics(naicsCode);
  if (!entry) return null;

  const tier = getRevenueTier(annualRevenue);
  const baseProfile = BASE_PROFILES[entry.group];
  const basePercentiles = entry.overrides?.[metricId] ?? baseProfile[metricId];
  if (!basePercentiles) return null;

  // Apply tier adjustment
  const tierMult = TIER_ADJUSTMENTS[tier][metricId] ?? 1.0;
  const adjusted: Percentiles = {
    p25: basePercentiles.p25 * tierMult,
    p50: basePercentiles.p50 * tierMult,
    p75: basePercentiles.p75 * tierMult,
    p90: basePercentiles.p90 * tierMult,
  };

  return {
    percentiles: adjusted,
    naicsDescription: entry.description,
    revenueTier: tier,
  };
}

// ---------------------------------------------------------------------------
// Percentile interpolation
//
// Given a value and p25/p50/p75/p90 breakpoints, estimate the percentile.
// Uses linear interpolation between bands:
//   0–25th:  value < p25 → extrapolate down to 0
//   25–50th: p25 ≤ value < p50
//   50–75th: p50 ≤ value < p75
//   75–90th: p75 ≤ value < p90
//   90–100:  value ≥ p90 → extrapolate up to 100
// ---------------------------------------------------------------------------

function interpolatePercentile(
  value: number,
  pcts: Percentiles,
  lowerIsBetter: boolean,
): number {
  // For "lower is better" metrics, invert: lower value = higher percentile
  const v = lowerIsBetter ? -value : value;
  const p25 = lowerIsBetter ? -pcts.p25 : pcts.p25;
  const p50 = lowerIsBetter ? -pcts.p50 : pcts.p50;
  const p75 = lowerIsBetter ? -pcts.p75 : pcts.p75;
  const p90 = lowerIsBetter ? -pcts.p90 : pcts.p90;

  // For lower-is-better, the inverted values make higher = better
  // But the percentile bands are also inverted, so we need to re-sort
  const sorted = [
    { pct: 25, val: Math.min(p25, p50, p75, p90) },
    { pct: 50, val: sortedVal(p25, p50, p75, p90, 1) },
    { pct: 75, val: sortedVal(p25, p50, p75, p90, 2) },
    { pct: 90, val: Math.max(p25, p50, p75, p90) },
  ];

  if (v <= sorted[0].val) {
    // Below p25 → extrapolate to 0
    if (sorted[0].val === 0) return 0;
    const ratio = v / sorted[0].val;
    return Math.max(0, Math.round(25 * ratio));
  }
  if (v >= sorted[3].val) {
    // Above p90 → extrapolate to 100
    if (sorted[3].val === sorted[2].val) return 95;
    const excess = (v - sorted[3].val) / (sorted[3].val - sorted[2].val);
    return Math.min(99, Math.round(90 + 10 * Math.min(excess, 1)));
  }

  // Find which band we're in
  for (let i = 0; i < 3; i++) {
    if (v >= sorted[i].val && v < sorted[i + 1].val) {
      const range = sorted[i + 1].val - sorted[i].val;
      if (range === 0) return sorted[i].pct;
      const frac = (v - sorted[i].val) / range;
      return Math.round(sorted[i].pct + frac * (sorted[i + 1].pct - sorted[i].pct));
    }
  }

  return 50; // fallback
}

function sortedVal(a: number, b: number, c: number, d: number, idx: number): number {
  return [a, b, c, d].sort((x, y) => x - y)[idx];
}

// ---------------------------------------------------------------------------
// Assessment from percentile
// ---------------------------------------------------------------------------

function assessFromPercentile(percentile: number): BenchmarkAssessment {
  if (percentile >= 75) return "strong";
  if (percentile >= 50) return "adequate";
  if (percentile >= 25) return "weak";
  return "concerning";
}

// ---------------------------------------------------------------------------
// Metric labels for narratives
// ---------------------------------------------------------------------------

const METRIC_LABELS: Record<BenchmarkMetricId, { label: string; unit: string }> = {
  GROSS_MARGIN:       { label: "Gross margin", unit: "%" },
  EBITDA_MARGIN:      { label: "EBITDA margin", unit: "%" },
  NET_MARGIN:         { label: "Net margin", unit: "%" },
  CURRENT_RATIO:      { label: "Current ratio", unit: "x" },
  QUICK_RATIO:        { label: "Quick ratio", unit: "x" },
  DEBT_TO_EQUITY:     { label: "Debt-to-equity", unit: "x" },
  DSCR:               { label: "DSCR", unit: "x" },
  DSO:                { label: "DSO", unit: " days" },
  DIO:                { label: "DIO", unit: " days" },
  DPO:                { label: "DPO", unit: " days" },
  INVENTORY_TURNOVER: { label: "Inventory turnover", unit: "x" },
  DEBT_TO_EBITDA:     { label: "Debt/EBITDA", unit: "x" },
  ROA:                { label: "ROA", unit: "%" },
  ROE:                { label: "ROE", unit: "%" },
  INTEREST_COVERAGE:  { label: "Interest coverage", unit: "x" },
};

function formatValue(value: number, metricId: BenchmarkMetricId): string {
  const meta = METRIC_LABELS[metricId];
  if (meta.unit === "%") return `${(value * 100).toFixed(1)}%`;
  if (meta.unit === " days") return `${Math.round(value)} days`;
  return `${value.toFixed(2)}x`;
}

function formatPeer(value: number, metricId: BenchmarkMetricId): string {
  const meta = METRIC_LABELS[metricId];
  if (meta.unit === "%") return `${(value * 100).toFixed(1)}%`;
  if (meta.unit === " days") return `${Math.round(value)} days`;
  return `${value.toFixed(2)}x`;
}

// ---------------------------------------------------------------------------
// Main comparison function
// ---------------------------------------------------------------------------

export function benchmarkRatio(
  value: number,
  metricId: BenchmarkMetricId,
  naicsCode: string,
  annualRevenue: number,
): RatioBenchmarkOutput | null {
  const lookup = lookupBenchmark(naicsCode, metricId, annualRevenue);
  if (!lookup) return null;

  const lowerIsBetter = LOWER_IS_BETTER.has(metricId);
  const percentile = interpolatePercentile(value, lookup.percentiles, lowerIsBetter);
  const assessment = assessFromPercentile(percentile);
  const meta = METRIC_LABELS[metricId];

  const narrative = `${meta.label} of ${formatValue(value, metricId)} is at the ${ordinal(percentile)} percentile for NAICS ${naicsCode} (${lookup.naicsDescription}); industry median is ${formatPeer(lookup.percentiles.p50, metricId)}.`;

  return {
    value,
    canonicalKey: metricId,
    industryNaics: naicsCode,
    naicsDescription: lookup.naicsDescription,
    revenueTier: lookup.revenueTier,
    percentile,
    assessment,
    peerMedian: lookup.percentiles.p50,
    peerP25: lookup.percentiles.p25,
    peerP75: lookup.percentiles.p75,
    narrative,
  };
}

// ---------------------------------------------------------------------------
// Batch benchmark — run all applicable metrics for an entity
// ---------------------------------------------------------------------------

export function benchmarkAll(
  metricValues: Partial<Record<BenchmarkMetricId, number>>,
  naicsCode: string,
  annualRevenue: number,
): RatioBenchmarkOutput[] {
  const results: RatioBenchmarkOutput[] = [];
  for (const metricId of BENCHMARK_METRIC_IDS) {
    const value = metricValues[metricId];
    if (value === undefined || value === null) continue;
    const result = benchmarkRatio(value, metricId, naicsCode, annualRevenue);
    if (result) results.push(result);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Catalog queries
// ---------------------------------------------------------------------------

export function getNaicsDescription(naicsCode: string): string | null {
  const entry = resolveNaics(naicsCode);
  return entry?.description ?? null;
}

export function getSupportedNaicsCodes(): string[] {
  return Object.keys(NAICS_CATALOG);
}

export function getAvailableMetrics(naicsCode: string): BenchmarkMetricId[] {
  const entry = resolveNaics(naicsCode);
  if (!entry) return [];
  const profile = BASE_PROFILES[entry.group];
  return BENCHMARK_METRIC_IDS.filter((id) => profile[id] !== undefined);
}

// ---------------------------------------------------------------------------
// SBA Default Profile Lookup (Phase 58A)
// ---------------------------------------------------------------------------

import type { SupabaseClient } from "@supabase/supabase-js";

export interface SBAIndustryDefaultProfile {
  naicsCode: string;
  naicsDescription: string | null;
  defaultRatePct: number | null;
  chargeOffRatePct: number | null;
  defaultRiskTier: "low" | "medium" | "high" | "very_high" | null;
  sampleSize: number | null;
  dataPeriod: string | null;
  notes: string | null;
  defaultRateFormatted: string;
  benchmarkAvailable: boolean;
}

export async function getSBAIndustryDefaultProfile(
  naicsCode: string,
  sb: SupabaseClient,
): Promise<SBAIndustryDefaultProfile> {
  const { data: rawData } = await sb
    .from("buddy_industry_benchmarks")
    .select(
      "naics_code, naics_description, sba_default_rate_pct, " +
        "sba_charge_off_rate_pct, sba_default_risk_tier, " +
        "sba_sample_size, sba_data_period, sba_notes",
    )
    .or(
      `naics_code.eq.${naicsCode},` +
        `naics_code.eq.${naicsCode.slice(0, 4)},` +
        `naics_code.eq.${naicsCode.slice(0, 2)}`,
    )
    .order("naics_code", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Cast to Record to access SBA columns that may not be in generated types
  const data = rawData as Record<string, unknown> | null;

  if (!data || data.sba_default_rate_pct === null || data.sba_default_rate_pct === undefined) {
    return {
      naicsCode,
      naicsDescription: null,
      defaultRatePct: null,
      chargeOffRatePct: null,
      defaultRiskTier: null,
      sampleSize: null,
      dataPeriod: null,
      notes: null,
      defaultRateFormatted: "N/A",
      benchmarkAvailable: false,
    };
  }

  const defaultRate = Number(data.sba_default_rate_pct);
  return {
    naicsCode: String(data.naics_code ?? naicsCode),
    naicsDescription: (data.naics_description as string) ?? null,
    defaultRatePct: defaultRate,
    chargeOffRatePct: data.sba_charge_off_rate_pct != null ? Number(data.sba_charge_off_rate_pct) : null,
    defaultRiskTier:
      (data.sba_default_risk_tier as SBAIndustryDefaultProfile["defaultRiskTier"]) ??
      null,
    sampleSize: data.sba_sample_size != null ? Number(data.sba_sample_size) : null,
    dataPeriod: (data.sba_data_period as string) ?? null,
    notes: (data.sba_notes as string) ?? null,
    defaultRateFormatted: `${(defaultRate * 100).toFixed(1)}%`,
    benchmarkAvailable: true,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
