import "server-only";

import {
  writeRentRollRows,
  type ExtractedRentRollRow,
  type ExtractionResult,
} from "../shared";
import type { DeterministicExtractorArgs } from "./types";
import { parseMoney, parseTable, findDateOnDocument } from "./parseUtils";
import {
  extractTables,
  extractEntitiesFlat,
  entityToMoney,
  type DocAiTable,
} from "./docAiParser";

// ---------------------------------------------------------------------------
// Header detection patterns for rent roll tables
// ---------------------------------------------------------------------------

const HEADER_PATTERN =
  /\b(unit|suite|apt|space)\b.*\b(tenant|name|lessee|occupant|rent|rate|status)\b/i;

/** Map common header labels to canonical field names. */
const HEADER_MAP: Record<string, keyof ExtractedRentRollRow> = {
  unit: "unit_id",
  "unit #": "unit_id",
  "unit id": "unit_id",
  "unit no": "unit_id",
  suite: "unit_id",
  apt: "unit_id",
  space: "unit_id",
  tenant: "tenant_name",
  "tenant name": "tenant_name",
  lessee: "tenant_name",
  name: "tenant_name",
  occupant: "tenant_name",
  type: "unit_type",
  "unit type": "unit_type",
  config: "unit_type",
  sqft: "sqft",
  "sq ft": "sqft",
  "square feet": "sqft",
  sf: "sqft",
  "monthly rent": "monthly_rent",
  "rent/mo": "monthly_rent",
  "mo rent": "monthly_rent",
  rent: "monthly_rent",
  "annual rent": "annual_rent",
  "rent/yr": "annual_rent",
  "yr rent": "annual_rent",
  annual: "annual_rent",
  "market rent": "market_rent_monthly",
  market: "market_rent_monthly",
  "lease start": "lease_start",
  "start date": "lease_start",
  "move in": "lease_start",
  "lease end": "lease_end",
  "end date": "lease_end",
  "move out": "lease_end",
  expiration: "lease_end",
  status: "occupancy_status" as any,
  notes: "notes",
  concessions: "concessions_monthly",
};

// ---------------------------------------------------------------------------
// Extractor
// ---------------------------------------------------------------------------

export async function extractRentRollDeterministic(
  args: DeterministicExtractorArgs,
): Promise<ExtractionResult & { extractionPath: string }> {
  if (!args.ocrText.trim() && !args.docAiJson) {
    return { ok: true, factsWritten: 0, extractionPath: "ocr_regex" };
  }

  // Try DocAI structured tables first
  if (args.docAiJson) {
    const docAiResult = tryDocAiTables(args);
    if (docAiResult && docAiResult.rows.length > 0) {
      const asOfDate = findDateOnDocument(args.ocrText) ?? new Date().toISOString().slice(0, 10);
      const result = await writeRentRollRows({
        dealId: args.dealId,
        bankId: args.bankId,
        sourceDocumentId: args.documentId,
        asOfDate,
        rows: docAiResult.rows,
      });
      return { ...result, extractionPath: "docai_table" };
    }
  }

  // Fallback to OCR regex table parsing
  const ocrResult = tryOcrTableParse(args);
  if (ocrResult.rows.length === 0) {
    return { ok: true, factsWritten: 0, extractionPath: "ocr_regex" };
  }

  const asOfDate = findDateOnDocument(args.ocrText) ?? new Date().toISOString().slice(0, 10);
  const result = await writeRentRollRows({
    dealId: args.dealId,
    bankId: args.bankId,
    sourceDocumentId: args.documentId,
    asOfDate,
    rows: ocrResult.rows,
  });
  return { ...result, extractionPath: "ocr_regex" };
}

// ---------------------------------------------------------------------------
// DocAI path: parse structured tables
// ---------------------------------------------------------------------------

function tryDocAiTables(
  args: DeterministicExtractorArgs,
): { rows: ExtractedRentRollRow[] } | null {
  const tables = extractTables(args.docAiJson);
  if (tables.length === 0) return null;

  // Find the best rent roll table (largest table with unit-like headers)
  let bestTable: DocAiTable | null = null;
  let bestScore = 0;

  for (const table of tables) {
    const headers = table.headerRows[0] ?? [];
    const score = scoreRentRollHeaders(headers);
    if (score > bestScore) {
      bestScore = score;
      bestTable = table;
    }
  }

  if (!bestTable || bestScore < 2) return null;

  const headers = bestTable.headerRows[0] ?? [];
  const colMap = mapHeadersToFields(headers);

  const rows: ExtractedRentRollRow[] = [];
  for (const bodyRow of bestTable.bodyRows) {
    const row = parseRentRollRow(bodyRow, colMap);
    if (row) rows.push(row);
  }

  return { rows };
}

// ---------------------------------------------------------------------------
// OCR path: regex table parsing
// ---------------------------------------------------------------------------

function tryOcrTableParse(
  args: DeterministicExtractorArgs,
): { rows: ExtractedRentRollRow[] } {
  const table = parseTable(args.ocrText, HEADER_PATTERN);
  if (!table || table.headers.length < 2) return { rows: [] };

  const colMap = mapHeadersToFields(table.headers);
  if (!colMap.has("unit_id")) return { rows: [] };

  const rows: ExtractedRentRollRow[] = [];
  for (const rowCells of table.rows) {
    const row = parseRentRollRow(rowCells, colMap);
    if (row) rows.push(row);
  }

  return { rows };
}

// ---------------------------------------------------------------------------
// Shared parsing logic
// ---------------------------------------------------------------------------

function scoreRentRollHeaders(headers: string[]): number {
  let score = 0;
  const joined = headers.join(" ").toLowerCase();
  if (/unit|suite|apt|space/.test(joined)) score += 2;
  if (/tenant|name|occupant/.test(joined)) score += 1;
  if (/rent|rate|amount/.test(joined)) score += 1;
  if (/status|occup/.test(joined)) score += 1;
  return score;
}

function mapHeadersToFields(
  headers: string[],
): Map<string, number> {
  const map = new Map<string, number>();

  for (let i = 0; i < headers.length; i++) {
    const h = headers[i].toLowerCase().trim();

    // Direct match
    if (HEADER_MAP[h]) {
      map.set(String(HEADER_MAP[h]), i);
      continue;
    }

    // Partial match
    for (const [key, field] of Object.entries(HEADER_MAP)) {
      if (h.includes(key) && !map.has(String(field))) {
        map.set(String(field), i);
      }
    }
  }

  return map;
}

function parseRentRollRow(
  cells: string[],
  colMap: Map<string, number>,
): ExtractedRentRollRow | null {
  const get = (field: string): string | null => {
    const idx = colMap.get(field);
    if (idx === undefined || idx >= cells.length) return null;
    const v = cells[idx]?.trim();
    return v || null;
  };

  const getMoney = (field: string): number | null => {
    const raw = get(field);
    return raw ? parseMoney(raw) : null;
  };

  const getNum = (field: string): number | null => {
    const raw = get(field);
    if (!raw) return null;
    const n = Number(raw.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  };

  const unitId = get("unit_id");
  if (!unitId) return null;

  const tenantName = get("tenant_name");
  const statusRaw = (get("occupancy_status") ?? "").toUpperCase();
  const occupancy: "OCCUPIED" | "VACANT" =
    statusRaw === "VACANT" || statusRaw === "V" || (!tenantName && statusRaw !== "OCCUPIED")
      ? "VACANT"
      : "OCCUPIED";

  const leaseStart = normalizeDate(get("lease_start"));
  const leaseEnd = normalizeDate(get("lease_end"));

  return {
    unit_id: unitId,
    tenant_name: tenantName,
    occupancy_status: occupancy,
    unit_type: get("unit_type"),
    sqft: getNum("sqft"),
    monthly_rent: getMoney("monthly_rent"),
    annual_rent: getMoney("annual_rent"),
    market_rent_monthly: getMoney("market_rent_monthly"),
    lease_start: leaseStart,
    lease_end: leaseEnd,
    concessions_monthly: getMoney("concessions_monthly"),
    notes: get("notes"),
  };
}

function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  // MM/DD/YYYY or M/D/YYYY
  const usMatch = raw.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (usMatch) {
    return `${usMatch[3]}-${usMatch[1].padStart(2, "0")}-${usMatch[2].padStart(2, "0")}`;
  }

  // MM/DD/YY
  const shortMatch = raw.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2})$/);
  if (shortMatch) {
    const yr = Number(shortMatch[3]) + (Number(shortMatch[3]) > 50 ? 1900 : 2000);
    return `${yr}-${shortMatch[1].padStart(2, "0")}-${shortMatch[2].padStart(2, "0")}`;
  }

  return null;
}
