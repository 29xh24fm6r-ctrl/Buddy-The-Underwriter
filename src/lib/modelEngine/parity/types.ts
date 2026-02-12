/**
 * Model Engine V2 — Parity Types
 *
 * Structured comparison types for V1-vs-V2 parity checking.
 * Read-only. No DB mutation, no lifecycle mutation, no persist.
 */

// ---------------------------------------------------------------------------
// Diff primitives
// ---------------------------------------------------------------------------

export type DiffSection = "income" | "balance" | "cashflow";
export type DiffStatus = "match" | "mismatch" | "v1_only" | "v2_only" | "both_null";
export type ParityVerdict = "PASS" | "FAIL";

// ---------------------------------------------------------------------------
// Period alignment
// ---------------------------------------------------------------------------

export interface PeriodAlignment {
  periodEnd: string;            // YYYY-MM-DD
  v1Label: string | null;
  v1ColumnKey: string | null;
  v2PeriodEnd: string | null;
  aligned: boolean;
  source: "v1_only" | "v2_only" | "both";
}

// ---------------------------------------------------------------------------
// Line diffs
// ---------------------------------------------------------------------------

export interface LineDiff {
  section: DiffSection;
  key: string;                  // canonical comparison key
  label: string;                // human-readable
  periodEnd: string;
  v1Value: number | null;
  v2Value: number | null;
  absDiff: number | null;
  pctDiff: number | null;
  status: DiffStatus;
}

// ---------------------------------------------------------------------------
// Headline diffs
// ---------------------------------------------------------------------------

export interface HeadlineDiff {
  metric: string;
  periodEnd: string;
  v1Value: number | null;
  v2Value: number | null;
  absDiff: number | null;
  pctDiff: number | null;
  withinTolerance: boolean;
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

export type ParityFlagType =
  | "missing_row"
  | "zero_filled"
  | "sign_flip"
  | "scaling_error"
  | "missing_period";

export interface ParityFlag {
  type: ParityFlagType;
  detail: string;
  severity: "error" | "warning";
}

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

export interface ParityThresholds {
  lineItemTolerance: number;       // absolute ($) tolerance for line items
  headlineAbsTolerance: number;    // absolute ($) tolerance for headline metrics
  headlinePctTolerance: number;    // percentage tolerance (0.01 = 1%)
  missingPeriodFails: boolean;     // any missing period => fail
}

// ---------------------------------------------------------------------------
// Top-level result
// ---------------------------------------------------------------------------

export interface ParityComparison {
  dealId: string;
  periods: PeriodAlignment[];
  diffs: LineDiff[];
  headline: HeadlineDiff[];
  flags: ParityFlag[];
  passFail: ParityVerdict;
  thresholdsUsed: ParityThresholds;
}

// ---------------------------------------------------------------------------
// V1 normalized shapes (extracted from deal_spreads rendered_json)
// ---------------------------------------------------------------------------

export interface V1PeriodColumn {
  key: string;
  label: string;
  endDate: string | null;
  isAggregate: boolean; // true for TTM, YTD, PY_YTD
}

export interface V1RowData {
  key: string;
  label: string;
  section: string | null;
  valueByPeriod: Record<string, number | null>; // period key → value
}

export interface V1SpreadData {
  spreadType: string;
  periods: V1PeriodColumn[];
  rows: V1RowData[];
}
