/**
 * Model Engine V2 — V1 (Legacy) Adapter
 *
 * Converts RenderedSpread → SpreadViewModel.
 * READ-ONLY transform — never writes to DB, never modifies the source spread.
 *
 * PHASE 3 SCOPE: Shadow comparison only.
 */

import { classifyRowKind } from "@/components/deals/spreads/SpreadTable";
import type { RenderedSpread, RenderedSpreadCellV2 } from "@/lib/financialSpreads/types";
import type { SpreadViewColumn, SpreadViewRow, SpreadViewSection, SpreadViewModel } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse a value to number | null.
 * RenderedSpread cells may store numbers as strings.
 */
function toNumericValue(val: unknown): number | null {
  if (val === null || val === undefined) return null;
  if (typeof val === "number") return Number.isFinite(val) ? val : null;
  if (typeof val === "string") {
    // Strip commas and parens for negative numbers like "(1,234)"
    const cleaned = val.replace(/[,()$%]/g, "").trim();
    if (cleaned === "" || cleaned === "—" || cleaned === "-") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Check if a row is a section header.
 */
function isSectionHeader(row: { key: string; notes?: string | null }): boolean {
  return row.notes === "section_header" || row.key.startsWith("_header_");
}

/**
 * Extract statement key from a section header row key.
 * e.g., "_header_BALANCE_SHEET" → "BALANCE_SHEET"
 */
function extractStatementKey(headerKey: string): string {
  if (headerKey.startsWith("_header_")) {
    return headerKey.slice("_header_".length);
  }
  return headerKey;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

/**
 * Convert a legacy RenderedSpread into a SpreadViewModel.
 *
 * @param spread - RenderedSpread from deal_spreads.rendered_json
 * @param dealId - Deal ID for traceability
 */
export function renderFromLegacySpread(
  spread: RenderedSpread,
  dealId: string,
): SpreadViewModel {
  const generatedAt = new Date().toISOString();

  // Build columns from columnsV2 (preferred) or fallback to columns
  const columns: SpreadViewColumn[] = (spread.columnsV2 ?? []).map((c) => ({
    key: String(c.key),
    label: String(c.label),
    kind: String(c.kind ?? "other"),
  }));

  // If no columnsV2, synthesize from string columns
  if (columns.length === 0 && spread.columns.length > 0) {
    for (const label of spread.columns) {
      columns.push({ key: label, label, kind: "other" });
    }
  }

  const columnKeys = new Set(columns.map((c) => c.key));

  // Group rows into sections
  const sections: SpreadViewSection[] = [];
  let currentSection: SpreadViewSection | null = null;
  let nonNullCellCount = 0;

  for (const row of spread.rows) {
    // Section header detection
    if (isSectionHeader(row)) {
      currentSection = {
        key: extractStatementKey(row.key),
        label: row.label,
        rows: [],
      };
      sections.push(currentSection);
      continue;
    }

    // If no section started yet, create a default
    if (!currentSection) {
      currentSection = {
        key: "_default",
        label: "Financial Data",
        rows: [],
      };
      sections.push(currentSection);
    }

    // Extract cell data
    const cell = Array.isArray(row.values) ? row.values[0] : null;
    const valueByCol: Record<string, number | null> = {};
    const displayByCol: Record<string, string | null> = {};

    if (cell && typeof cell === "object" && !Array.isArray(cell)) {
      const cellV2 = cell as RenderedSpreadCellV2;

      // Extract multi-period values
      if (cellV2.valueByCol) {
        for (const colKey of columnKeys) {
          if (colKey in cellV2.valueByCol) {
            const numVal = toNumericValue(cellV2.valueByCol[colKey]);
            valueByCol[colKey] = numVal;
            if (numVal !== null) nonNullCellCount++;
          }
        }
      }

      // Extract display values
      if (cellV2.displayByCol) {
        for (const colKey of columnKeys) {
          if (colKey in cellV2.displayByCol) {
            displayByCol[colKey] = cellV2.displayByCol[colKey] ?? "—";
          }
        }
      }
    }

    // Ensure all columns have entries (fill missing with null / "—")
    for (const colKey of columnKeys) {
      if (!(colKey in valueByCol)) {
        valueByCol[colKey] = null;
      }
      if (!(colKey in displayByCol)) {
        displayByCol[colKey] = "—";
      }
    }

    const viewRow: SpreadViewRow = {
      key: row.key,
      label: row.label,
      section: row.section ?? null,
      kind: classifyRowKind({ key: row.key, formula: row.formula ?? null, section: row.section ?? null }),
      valueByCol,
      displayByCol,
      formulaId: row.formula ?? null,
    };

    currentSection.rows.push(viewRow);
  }

  const rowCount = sections.reduce((sum, s) => sum + s.rows.length, 0);

  return {
    source: "v1_legacy",
    dealId,
    generatedAt,
    columns,
    sections,
    meta: {
      rowCount,
      sectionCount: sections.length,
      periodCount: columns.length,
      nonNullCellCount,
    },
  };
}
