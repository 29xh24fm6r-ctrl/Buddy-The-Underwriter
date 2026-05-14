/**
 * SPEC-AR-AGING-STRUCTURED-ASSIST-1
 *
 * Pure module — no DB, no IO, no server-only.
 *
 * Converts Gemini Flash structured assist output (the `structuredJson` field
 * on `document_extracts.fields_json`) into a native-table-shaped rows array
 * that `extractArAgingTables()`'s `normalizeNativeTables()` path consumes.
 *
 * Input shape (from structured-assist):
 *   {
 *     entities: [{ type: 'ar_aging_cell', mentionText: '...', ... }],
 *     formFields: [
 *       { name: 'ar_aging_cell:0:customer', value: 'Humana', confidence: 0.99 },
 *       { name: 'ar_aging_cell:0:current', value: '715515.60', confidence: 0.99 },
 *       { name: 'ar_aging_cell:0:d1_30', value: '17278.80', confidence: 0.99 },
 *       ...
 *       { name: 'aging_type', value: 'AR', confidence: 1 },
 *       { name: 'entity_name', value: 'OmniCare365', confidence: 1 },
 *       { name: 'as_of_date', value: '2026-04-28', confidence: 1 },
 *     ]
 *   }
 *
 * Output shape (consumed by arAgingTableExtractor.normalizeNativeTables):
 *   {
 *     rows: [
 *       ['Customer', 'Current', '1-30', '31-60', '61-90', '91+', 'Total'],
 *       ['Humana', '715515.60', '17278.80', '125763.00', '10154.75', '98765.56', '967477.71'],
 *       ...
 *     ]
 *   }
 *
 * Returns null if:
 *   - input is null / not the expected shape
 *   - aging_type formField says 'AP' (refuse — AP aging is rejected downstream)
 *   - no ar_aging_cell formFields are present
 *   - no rows survive parsing
 */

const BUCKETS_IN_ORDER = ["current", "d1_30", "d31_60", "d61_90", "d91_plus", "total"] as const;
const BUCKET_LABELS: Record<typeof BUCKETS_IN_ORDER[number], string> = {
  current: "Current",
  d1_30: "1-30",
  d31_60: "31-60",
  d61_90: "61-90",
  d91_plus: "91+",
  total: "Total",
};

type CellFormField = { name: string; value: string };

type ArAgingNativeTable = {
  rows: string[][];
};

export function synthesizeArAgingTableFromStructuredAssist(
  structuredJson: unknown,
): ArAgingNativeTable | null {
  if (!structuredJson || typeof structuredJson !== "object") return null;

  const formFields = (structuredJson as any).formFields;
  if (!Array.isArray(formFields) || formFields.length === 0) return null;

  // Refuse AP aging
  const agingTypeField = formFields.find(
    (f: any) => f && typeof f === "object" && f.name === "aging_type",
  );
  if (
    agingTypeField &&
    typeof agingTypeField.value === "string" &&
    agingTypeField.value.trim().toUpperCase() === "AP"
  ) {
    return null;
  }

  // Group cell formFields by row_index
  const byRow = new Map<number, Map<string, string>>();
  const cellRegex = /^ar_aging_cell:(\d+):([a-z0-9_]+)$/i;

  for (const f of formFields) {
    if (!f || typeof f !== "object" || typeof f.name !== "string") continue;
    const m = cellRegex.exec(f.name);
    if (!m) continue;

    const rowIndex = parseInt(m[1], 10);
    const bucket = m[2].toLowerCase();
    if (!Number.isFinite(rowIndex) || rowIndex < 0) continue;

    if (!byRow.has(rowIndex)) byRow.set(rowIndex, new Map());
    byRow.get(rowIndex)!.set(bucket, String((f as CellFormField).value ?? "").trim());
  }

  if (byRow.size === 0) return null;

  // Sort rows by index
  const sortedRowIndices = Array.from(byRow.keys()).sort((a, b) => a - b);

  // Build header — only include buckets we actually have data for
  const presentBuckets = new Set<string>();
  for (const row of byRow.values()) {
    for (const b of row.keys()) {
      if (b !== "customer") presentBuckets.add(b);
    }
  }

  const headerRow: string[] = ["Customer"];
  const orderedBuckets: string[] = [];
  for (const b of BUCKETS_IN_ORDER) {
    if (presentBuckets.has(b)) {
      headerRow.push(BUCKET_LABELS[b]);
      orderedBuckets.push(b);
    }
  }

  // Need at least 3 numeric columns for arAgingTableExtractor.looksLikeArAgingHeader to accept it
  if (orderedBuckets.length < 3) return null;

  const dataRows: string[][] = [];
  for (const idx of sortedRowIndices) {
    const row = byRow.get(idx)!;
    const customer = row.get("customer") ?? "";
    if (!customer || customer.length === 0) continue;

    const cells: string[] = [customer];
    for (const bucket of orderedBuckets) {
      const raw = row.get(bucket) ?? "";
      cells.push(normalizeCellValue(raw));
    }
    dataRows.push(cells);
  }

  if (dataRows.length === 0) return null;

  return {
    rows: [headerRow, ...dataRows],
  };
}

function normalizeCellValue(raw: string): string {
  const s = raw.trim();
  if (!s || s === "-" || s === "—") return "0";

  // Parens = negative
  const parens = /^\(\s*\$?(.+?)\s*\)$/.exec(s);
  const inner = parens ? `-${parens[1]}` : s;

  // Strip $, whitespace, commas
  return inner.replace(/[$,\s]/g, "");
}
