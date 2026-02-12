/**
 * Model Engine V2 — Parity Harness (public API)
 */

export { compareModels, compareV1toV2, extractV1SpreadData } from "./compareV1toV2";
export { formatParityReport } from "./parityReport";
export { DEFAULT_THRESHOLDS, RELAXED_THRESHOLDS } from "./thresholds";
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
