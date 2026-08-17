/**
 * Parser for the official SBA "Table of Size Standards" XLSX, used as the
 * independent cross-check against the SBA JSON base dataset.
 *
 * SPEC-SBA-SIZE-STANDARDS-REFERENCE-1, Phase 1.
 *
 * Current file per data.sba.gov:
 *   sba-table-of-size-standards_effective-march-17-2023_v0.xlsx
 *   "Small Business Size Standards effective 3/17/2023 – Current"
 *
 * ─── Two defects from the legacy importer are fixed structurally ────────
 * scripts/industry-intelligence/ingest-sba-size-standards.ts (still in the
 * repo, deliberately untouched until cleanup) did two things wrong:
 *
 *   1. It looped EVERY worksheet in the workbook and appended rows from
 *      all of them, producing 2,023 six-digit rows that collapsed to only
 *      1,117 unique codes — the same industries counted more than once.
 *      Here, exactly one worksheet is selected, and finding more than one
 *      candidate is an error the operator must resolve, not a silent merge.
 *
 *   2. It inferred measure type from the magnitude of the value. Here the
 *      measure comes from WHICH COLUMN the value sits in, resolved from
 *      the header row, and column detection failing is fatal.
 *
 * Cell extraction only; all interpretation is delegated to the unit-tested
 * pure parser in parseSizeStandardRow.ts.
 */

import type { RawSizeStandardRow } from "./parseSizeStandardRow";

/** Minimal shape of an exceljs worksheet, so this module stays testable. */
export type SheetLike = {
  name: string;
  rows: string[][];
  /**
   * Per-row, per-column superscript runs lifted from rich-text cells.
   * Keyed [rowIndex][colIndex]. The official workbook marks footnote
   * references as superscript inside the title cell, which is formatting
   * rather than text — flattening loses it.
   */
  superscripts?: string[][][];
};

export type HeaderLayout = {
  headerRowIndex: number;
  naicsCol: number;
  titleCol: number;
  receiptsCol: number;
  employeesCol: number;
  /** "Footnotes" column; -1 when the sheet has none. */
  footnotesCol: number;
};

const NAICS_HEADER = /naics\s*code/i;
// The official workbook heads this column "NAICS Industry Description";
// §121.201 as rendered by eCFR uses "NAICS U.S. Industry Title". Both.
const TITLE_HEADER =
  /naics\s*(u\.?s\.?\s*)?industry\s*(title|description)|industry\s*(title|description)/i;
const FOOTNOTES_HEADER = /^footnotes?$/i;
/** "Size standards in millions of dollars" */
const RECEIPTS_HEADER = /size\s*standards?\s*in\s*millions/i;
/** "Size standards in number of employees" */
const EMPLOYEES_HEADER = /size\s*standards?\s*in\s*number\s*of\s*employees/i;

export function findHeaderLayout(rows: string[][]): HeaderLayout | null {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 25); rowIndex++) {
    const row = rows[rowIndex] ?? [];
    let naicsCol = -1;
    let titleCol = -1;
    let receiptsCol = -1;
    let employeesCol = -1;
    let footnotesCol = -1;

    row.forEach((cell, colIndex) => {
      const text = (cell ?? "").replace(/\s+/g, " ").trim();
      if (!text) return;
      if (naicsCol < 0 && NAICS_HEADER.test(text)) naicsCol = colIndex;
      else if (titleCol < 0 && TITLE_HEADER.test(text)) titleCol = colIndex;
      if (receiptsCol < 0 && RECEIPTS_HEADER.test(text)) receiptsCol = colIndex;
      if (employeesCol < 0 && EMPLOYEES_HEADER.test(text)) employeesCol = colIndex;
      if (footnotesCol < 0 && FOOTNOTES_HEADER.test(text)) footnotesCol = colIndex;
    });

    // Both measure columns are required. A header row that yields only one
    // means the layout changed, and continuing would silently push every
    // value of the missing measure into the wrong field.
    if (naicsCol >= 0 && receiptsCol >= 0 && employeesCol >= 0) {
      return {
        headerRowIndex: rowIndex,
        naicsCol,
        titleCol: titleCol >= 0 ? titleCol : naicsCol + 1,
        receiptsCol,
        employeesCol,
        footnotesCol,
      };
    }
  }
  return null;
}

export class XlsxLayoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxLayoutError";
  }
}

/**
 * Selects the single worksheet containing the size-standard table.
 * Ambiguity is an error: silently merging sheets is what produced the
 * legacy artifact's duplicate rows.
 */
export function selectTableSheet(sheets: readonly SheetLike[]): {
  sheet: SheetLike;
  layout: HeaderLayout;
} {
  const candidates = sheets
    .map((sheet) => ({ sheet, layout: findHeaderLayout(sheet.rows) }))
    .filter((c): c is { sheet: SheetLike; layout: HeaderLayout } => c.layout !== null);

  if (candidates.length === 0) {
    throw new XlsxLayoutError(
      `No worksheet contained the expected header row (NAICS code / size standards ` +
        `in millions / size standards in number of employees). Sheets inspected: ` +
        sheets.map((s) => s.name).join(", "),
    );
  }

  if (candidates.length > 1) {
    throw new XlsxLayoutError(
      `${candidates.length} worksheets look like the size-standard table ` +
        `(${candidates.map((c) => c.sheet.name).join(", ")}). Refusing to merge them — ` +
        `the legacy importer did exactly this and double-counted 906 industries. ` +
        `Pass --xlsx-sheet <name> to choose explicitly.`,
    );
  }

  return candidates[0];
}

/** Extracts data rows below the header, preserving column identity. */
export function extractXlsxRows(
  sheet: SheetLike,
  layout: HeaderLayout,
): RawSizeStandardRow[] {
  const out: RawSizeStandardRow[] = [];
  const cell = (row: string[], index: number) => (row[index] ?? "").toString();

  for (let i = layout.headerRowIndex + 1; i < sheet.rows.length; i++) {
    const row = sheet.rows[i] ?? [];
    const naicsCell = cell(row, layout.naicsCol).trim();
    const titleCell = cell(row, layout.titleCol);
    // A blank code cell is not automatically skippable: sector headings
    // live in the description column with an empty code cell.
    if (!naicsCell && !titleCell.trim()) continue;

    out.push({
      naicsCell,
      titleCell: cell(row, layout.titleCol),
      receiptsCell: cell(row, layout.receiptsCol),
      employeesCell: cell(row, layout.employeesCol),
      footnotesCell:
        layout.footnotesCol >= 0 ? cell(row, layout.footnotesCol) : undefined,
      titleFootnoteRefs: sheet.superscripts?.[i]?.[layout.titleCol] ?? undefined,
    });
  }

  return out;
}
