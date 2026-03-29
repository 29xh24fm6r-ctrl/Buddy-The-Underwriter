/**
 * Industry Benchmarks Module — God Tier Phase 2D, Layer 6
 *
 * NAICS-level peer comparison for every ratio.
 * Pure functions — no DB, no server imports.
 */

export {
  type RevenueTier,
  type BenchmarkAssessment,
  type Percentiles,
  type RatioBenchmarkOutput,
  type BenchmarkLookupResult,
  type BenchmarkMetricId,
  BENCHMARK_METRIC_IDS,
  getRevenueTier,
  lookupBenchmark,
  benchmarkRatio,
  benchmarkAll,
  getNaicsDescription,
  getSupportedNaicsCodes,
  getAvailableMetrics,
} from "./industryBenchmarks";

// SBA exports (Phase 58A) — async DB function, separate export
export type { SBAIndustryDefaultProfile } from "./industryBenchmarks";
export { getSBAIndustryDefaultProfile } from "./industryBenchmarks";
