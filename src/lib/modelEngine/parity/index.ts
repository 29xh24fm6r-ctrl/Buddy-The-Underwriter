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
export {
  CANONICAL_PARITY_METRICS,
  CANONICAL_PARITY_METRIC_KEYS,
  EXPECTED_METRIC_COUNT,
} from "./metricDictionary";
export type { CanonicalParityMetricKey, ParityMetricDefinition } from "./metricDictionary";
export {
  evaluateParityGate,
  DEFAULT_PARITY_GATE_CONFIG,
} from "./parityGate";
export type {
  GateVerdict,
  MetricTypeThreshold,
  ParityGateConfig,
  ParityGateResult,
  ParityGateIssue,
} from "./parityGate";
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
