/**
 * Moody’s Financial Analysis (Gold Standard) — Canonical Mapping
 *
 * Fixture reference (not checked in here):
 *   /mnt/data/LTG FA Package (002).pdf
 *
 * IMPORTANT:
 * - DO NOT reorder rows.
 * - DO NOT rename labels.
 * - Every computed line must reference a named formula in formulas/registry.ts
 * - Every item must carry a source page reference to the PDF.
 */

export type MoodysStatement =
  | "BALANCE_SHEET"
  | "INCOME_STATEMENT"
  | "CASH_FLOW"
  | "RATIOS"
  | "EXEC_SUMMARY";

export type MoodysRow = {
  statement: MoodysStatement;
  section: string;
  order: number;
  label: string;
  key: string;
  formulaId?: string;
  isPercent?: boolean;
  precision?: number;
  sign?: "POSITIVE" | "PAREN_NEGATIVE";
  sourcePages: number[];
};

export const MOODYS_ROWS: MoodysRow[] = [
  // TODO: Populate every line item by extracting from the PDF fixture.
  // Start with the Balance Sheet page(s), then Income Statement, Cash Flow, Ratios, Exec Summary.
];
