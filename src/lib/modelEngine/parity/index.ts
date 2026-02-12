/**
 * Model Engine V2 — Parity Harness (public API)
 */

export { compareModels, compareV1toV2, extractV1SpreadData } from "./compareV1toV2";
export { formatParityReport } from "./parityReport";
export { DEFAULT_THRESHOLDS, RELAXED_THRESHOLDS } from "./thresholds";
export {
  buildParityReport,
  compareSpreadToModelV2,
  compareSpreadToModelV2Pure,
} from "./parityCompare";
export type { Diff, ParityReport, PeriodComparisonEntry, PeriodDifferences } from "./parityCompare";
export {
  extractSpreadParityMetrics,
  extractSpreadParityMetricsFromData,
  extractModelV2ParityMetrics,
  extractModelV2ParityMetricsFromModel,
  PARITY_METRIC_KEYS,
} from "./parityTargets";
export type { PeriodMetricMap, PeriodMetrics, ParityMetricKey } from "./parityTargets";
export type {
  ParityComparison,
  ParityThresholds,
  PeriodAlignment,
  LineDiff,
  HeadlineDiff,
  ParityFlag,
  ParityFlagType,
  ParityVerdict,
  DiffSection,
  DiffStatus,
  V1SpreadData,
  V1PeriodColumn,
  V1RowData,
} from "./types";
