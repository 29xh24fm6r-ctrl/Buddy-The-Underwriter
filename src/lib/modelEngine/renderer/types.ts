/**
 * Model Engine V2 — SpreadViewModel Contract
 *
 * Renderer-neutral view model for financial spread display.
 * Both V1 (legacy RenderedSpread) and V2 (FinancialModel) adapt to this shape.
 *
 * PHASE 3 SCOPE: Shadow comparison only.
 * Do NOT wire into production rendering paths until Phase 3 Part 2.
 */

import type { SpreadRowKind } from "@/components/deals/spreads/SpreadTable";

// Re-export for convenience
export type { SpreadRowKind };

// ---------------------------------------------------------------------------
// Column
// ---------------------------------------------------------------------------

export type SpreadViewColumn = {
  /** Period key: "2024-12-31", "CURRENT" */
  key: string;
  /** Display label: "Dec 2024", "Current" */
  label: string;
  /** Column kind: "month" | "ytd" | "other" */
  kind: string;
};

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

export type SpreadViewRow = {
  /** Row key matching Moody's mapping: "TOTAL_ASSETS", "CASH_AND_EQUIVALENTS" */
  key: string;
  /** Display label: "Total Assets", "Cash & Cash Equivalents" */
  label: string;
  /** Section within the statement: "Current Assets", "Revenue", etc. */
  section: string | null;
  /** Row styling kind — reuses SpreadTable's classification */
  kind: SpreadRowKind;
  /** Raw numeric values per column key */
  valueByCol: Record<string, number | null>;
  /** Pre-formatted display strings per column key */
  displayByCol: Record<string, string | null>;
  /** Formula ID for audit trail (null for source/fact-backed rows) */
  formulaId: string | null;
};

// ---------------------------------------------------------------------------
// Section (statement group)
// ---------------------------------------------------------------------------

export type SpreadViewSection = {
  /** Statement key: "BALANCE_SHEET", "INCOME_STATEMENT", etc. */
  key: string;
  /** Display label: "Balance Sheet", "Income Statement" */
  label: string;
  /** Rows in display order within this section */
  rows: SpreadViewRow[];
};

// ---------------------------------------------------------------------------
// Top-level ViewModel
// ---------------------------------------------------------------------------

export type SpreadViewModel = {
  /** Which adapter produced this ViewModel */
  source: "v1_legacy" | "v2_model";
  /** Deal ID for traceability */
  dealId: string;
  /** ISO timestamp when this ViewModel was generated */
  generatedAt: string;
  /** Period columns in display order */
  columns: SpreadViewColumn[];
  /** Statement sections in display order */
  sections: SpreadViewSection[];
  /** Summary metadata */
  meta: {
    /** Total data rows (excludes section headers) */
    rowCount: number;
    /** Number of statement sections */
    sectionCount: number;
    /** Number of period columns */
    periodCount: number;
    /** Count of non-null cells (for diff quality assessment) */
    nonNullCellCount: number;
  };
};
