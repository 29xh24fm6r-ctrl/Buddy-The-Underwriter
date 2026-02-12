/**
 * Model Engine V2 — SpreadViewModel Diff Utility
 *
 * Compares two SpreadViewModels (V1 legacy vs V2 model) row-by-row,
 * column-by-column. Produces a structured diff with materiality classification.
 *
 * PHASE 3 SCOPE: Shadow comparison only.
 */

import type { SpreadViewModel, SpreadViewSection, SpreadViewRow } from "./types";

// ---------------------------------------------------------------------------
// Diff types
// ---------------------------------------------------------------------------

export type CellDiff = {
  rowKey: string;
  columnKey: string;
  v1Value: number | null;
  v2Value: number | null;
  /** v2 - v1, null if either side is null */
  delta: number | null;
  /** abs(delta), null if delta is null */
  absDelta: number | null;
  /** Whether the diff is materially significant */
  material: boolean;
};

export type SectionDiff = {
  sectionKey: string;
  sectionLabel: string;
  /** Row keys present in V1 but not V2 */
  rowsOnlyInV1: string[];
  /** Row keys present in V2 but not V1 */
  rowsOnlyInV2: string[];
  /** Per-cell diffs for matching rows */
  cellDiffs: CellDiff[];
};

export type ViewModelDiffResult = {
  dealId: string;
  generatedAt: string;
  /** Whether column sets are identical */
  columnsMatch: boolean;
  /** Column key mismatches */
  columnDiffs: { onlyInV1: string[]; onlyInV2: string[] };
  /** Per-section diffs */
  sections: SectionDiff[];
  /** Aggregate summary */
  summary: {
    totalCells: number;
    matchingCells: number;
    differingCells: number;
    materialDiffs: number;
    maxAbsDelta: number;
    /** true if materialDiffs === 0 */
    pass: boolean;
  };
};

// ---------------------------------------------------------------------------
// Materiality threshold (same as Phase 2 parity)
// ---------------------------------------------------------------------------

/**
 * Determine if a numeric difference is materially significant.
 *
 * Material if:
 *   abs(delta) > 1   OR   abs(delta) / max(1, abs(v1)) > 0.0001
 *
 * This catches both absolute differences (> $1) and relative differences
 * (> 0.01%) for large values.
 */
function isMaterial(delta: number, v1Value: number): boolean {
  const abs = Math.abs(delta);
  if (abs > 1) return true;
  const denom = Math.max(1, Math.abs(v1Value));
  if (abs / denom > 0.0001) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Diff algorithm
// ---------------------------------------------------------------------------

function diffSection(
  v1Section: SpreadViewSection | undefined,
  v2Section: SpreadViewSection | undefined,
  columnKeys: string[],
): SectionDiff {
  const sectionKey = v1Section?.key ?? v2Section?.key ?? "unknown";
  const sectionLabel = v1Section?.label ?? v2Section?.label ?? "Unknown";

  const v1Rows = new Map<string, SpreadViewRow>();
  const v2Rows = new Map<string, SpreadViewRow>();

  for (const r of v1Section?.rows ?? []) v1Rows.set(r.key, r);
  for (const r of v2Section?.rows ?? []) v2Rows.set(r.key, r);

  const allRowKeys = new Set([...v1Rows.keys(), ...v2Rows.keys()]);
  const rowsOnlyInV1: string[] = [];
  const rowsOnlyInV2: string[] = [];
  const cellDiffs: CellDiff[] = [];

  for (const rowKey of allRowKeys) {
    const v1Row = v1Rows.get(rowKey);
    const v2Row = v2Rows.get(rowKey);

    if (!v1Row) {
      rowsOnlyInV2.push(rowKey);
      continue;
    }
    if (!v2Row) {
      rowsOnlyInV1.push(rowKey);
      continue;
    }

    // Compare cell values for each column
    for (const colKey of columnKeys) {
      const v1Val = v1Row.valueByCol[colKey] ?? null;
      const v2Val = v2Row.valueByCol[colKey] ?? null;

      // Both null → not a difference
      if (v1Val === null && v2Val === null) continue;

      let delta: number | null = null;
      let absDelta: number | null = null;
      let material = false;

      if (v1Val !== null && v2Val !== null) {
        delta = v2Val - v1Val;
        absDelta = Math.abs(delta);
        material = delta !== 0 && isMaterial(delta, v1Val);
      }

      // Only record if there's any difference (including null vs non-null)
      const isDifferent =
        delta !== null ? delta !== 0 :
        (v1Val === null) !== (v2Val === null); // one null, one not

      if (isDifferent) {
        cellDiffs.push({
          rowKey,
          columnKey: colKey,
          v1Value: v1Val,
          v2Value: v2Val,
          delta,
          absDelta,
          material,
        });
      }
    }
  }

  return { sectionKey, sectionLabel, rowsOnlyInV1, rowsOnlyInV2, cellDiffs };
}

/**
 * Compare two SpreadViewModels and produce a structured diff.
 *
 * @param v1 - ViewModel from V1 legacy adapter
 * @param v2 - ViewModel from V2 model adapter
 */
export function diffSpreadViewModels(
  v1: SpreadViewModel,
  v2: SpreadViewModel,
): ViewModelDiffResult {
  const generatedAt = new Date().toISOString();
  const dealId = v1.dealId || v2.dealId;

  // Column alignment
  const v1ColKeys = new Set(v1.columns.map((c) => c.key));
  const v2ColKeys = new Set(v2.columns.map((c) => c.key));
  const onlyInV1Cols = [...v1ColKeys].filter((k) => !v2ColKeys.has(k));
  const onlyInV2Cols = [...v2ColKeys].filter((k) => !v1ColKeys.has(k));
  const columnsMatch = onlyInV1Cols.length === 0 && onlyInV2Cols.length === 0;

  // Use intersection of column keys for cell comparison
  const sharedColumnKeys = [...v1ColKeys].filter((k) => v2ColKeys.has(k));

  // Section alignment
  const v1SectionMap = new Map<string, SpreadViewSection>();
  const v2SectionMap = new Map<string, SpreadViewSection>();
  for (const s of v1.sections) v1SectionMap.set(s.key, s);
  for (const s of v2.sections) v2SectionMap.set(s.key, s);

  const allSectionKeys = new Set([...v1SectionMap.keys(), ...v2SectionMap.keys()]);

  const sections: SectionDiff[] = [];
  let totalCells = 0;
  let differingCells = 0;
  let materialDiffs = 0;
  let maxAbsDelta = 0;

  for (const sectionKey of allSectionKeys) {
    const sectionDiff = diffSection(
      v1SectionMap.get(sectionKey),
      v2SectionMap.get(sectionKey),
      sharedColumnKeys,
    );
    sections.push(sectionDiff);

    // Count cells for matching rows
    const v1Rows = v1SectionMap.get(sectionKey)?.rows ?? [];
    const v2Rows = v2SectionMap.get(sectionKey)?.rows ?? [];
    const v1RowKeys = new Set(v1Rows.map((r) => r.key));
    const v2RowKeys = new Set(v2Rows.map((r) => r.key));
    const matchingRowCount = [...v1RowKeys].filter((k) => v2RowKeys.has(k)).length;
    totalCells += matchingRowCount * sharedColumnKeys.length;

    differingCells += sectionDiff.cellDiffs.length;
    for (const cd of sectionDiff.cellDiffs) {
      if (cd.material) materialDiffs++;
      if (cd.absDelta !== null && cd.absDelta > maxAbsDelta) {
        maxAbsDelta = cd.absDelta;
      }
    }
  }

  const matchingCells = totalCells - differingCells;

  return {
    dealId,
    generatedAt,
    columnsMatch,
    columnDiffs: { onlyInV1: onlyInV1Cols, onlyInV2: onlyInV2Cols },
    sections,
    summary: {
      totalCells,
      matchingCells,
      differingCells,
      materialDiffs,
      maxAbsDelta,
      pass: materialDiffs === 0,
    },
  };
}
