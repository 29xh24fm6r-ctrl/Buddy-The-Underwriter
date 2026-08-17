/**
 * Pure row parser for the 13 CFR §121.201 size-standard table.
 *
 * SPEC-SBA-SIZE-STANDARDS-REFERENCE-1, Phase 1.
 *
 * Kept deliberately separate from the importer script so the classification
 * logic — the part that gets a borrower's eligibility wrong when it's wrong
 * — is a pure function with no I/O and full unit coverage. The importer
 * handles fetching, hashing and file writing; this handles meaning.
 *
 * ─── The bug this file exists to prevent ────────────────────────────────
 * The legacy scripts/industry-intelligence/ingest-sba-size-standards.ts
 * decided measure type by asking whether the size value "looked like"
 * money. NAICS 211120 (Crude Petroleum Extraction) has a standard of
 * 1,250 EMPLOYEES; the legacy importer recorded it as $1.25 BILLION of
 * revenue. Any borrower in that industry would have been measured against
 * a threshold ~1000x too permissive, on the wrong axis entirely.
 *
 * The fix is structural, not heuristic: §121.201 publishes receipts and
 * employees in SEPARATE COLUMNS. Which column the value appears in IS the
 * measure. We never infer measure from magnitude.
 * ────────────────────────────────────────────────────────────────────────
 */

import type { SbaSizeStandardRecord, SizeStandardMeasure } from "./types";

/** A row as extracted from the source table, before interpretation. */
export type RawSizeStandardRow = {
  naicsCell: string;
  titleCell: string;
  /** "Size standards in millions of dollars" column. */
  receiptsCell: string;
  /** "Size standards in number of employees" column. */
  employeesCell: string;
};

export type RowParseResult =
  | { kind: "record"; record: SbaSizeStandardRecord }
  /** Sector/subsector heading rows — structural, carry no standard. */
  | { kind: "heading"; text: string }
  /** Row could not be interpreted. Never silently dropped. */
  | { kind: "malformed"; reason: string; row: RawSizeStandardRow };

/**
 * Depository-institution rows state their standard in millions of dollars
 * of ASSETS, not receipts. §121.201 flags these with a footnote and the
 * title/footnote text says "assets". Detected explicitly; never guessed
 * from magnitude.
 */
const ASSETS_MARKER = /\bassets\b/i;

/** Matches "115310 (Exception 1)" / "237900 (Exception)". */
const NAICS_WITH_EXCEPTION = /^(\d{6})\s*\((Exception(?:\s+\d+)?)\)$/i;
const NAICS_PLAIN = /^(\d{6})$/;

/** Trailing footnote markers, e.g. "Fruit and Vegetable Canning 3". */
const TRAILING_FOOTNOTES = /(?:\s+(\d{1,2}))+\s*$/;

function normalizeCell(value: string): string {
  return value
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Strips trailing footnote markers from a cell, returning the clean text
 * and the markers found. "$34.0 1" -> { text: "$34.0", refs: ["1"] }.
 */
export function splitFootnoteRefs(value: string): {
  text: string;
  refs: string[];
} {
  const normalized = normalizeCell(value);
  const match = normalized.match(TRAILING_FOOTNOTES);
  if (!match) return { text: normalized, refs: [] };

  const marker = match[0].trim();
  // Guard: a bare number cell ("500") is a VALUE, not a footnote. Only
  // treat trailing digits as footnotes when other content precedes them.
  const head = normalized.slice(0, normalized.length - match[0].length).trim();
  if (!head) return { text: normalized, refs: [] };

  return { text: head, refs: marker.split(/\s+/).filter(Boolean) };
}

/**
 * Parses a published numeric standard. Accepts "$34.0", "1,250", "12.5".
 * Returns null for empty cells. Returns NaN-free numbers or null only —
 * never a partially-parsed value.
 */
export function parseStandardValue(value: string): number | null {
  const cleaned = normalizeCell(value).replace(/[$,]/g, "");
  if (!cleaned) return null;
  if (!/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Interprets one source row.
 *
 * Measure resolution order (structural, not heuristic):
 *   1. employees column populated -> "employees"
 *   2. receipts column populated + assets marker -> "assets"
 *   3. receipts column populated -> "annual_receipts"
 *   4. neither populated -> "other" (flagged, never treated as a pass)
 *
 * A row with BOTH columns populated is malformed, not a judgment call:
 * §121.201 never publishes both, so it means the extraction misaligned
 * columns and every value in the run is suspect.
 */
export function parseSizeStandardRow(row: RawSizeStandardRow): RowParseResult {
  const naicsRaw = normalizeCell(row.naicsCell);
  const titleRaw = normalizeCell(row.titleCell);

  if (!naicsRaw) {
    return { kind: "malformed", reason: "empty NAICS cell", row };
  }

  // Heading rows: "Sector 11—Agriculture..." / "Subsector 111—Crop Production"
  if (/^(sector|subsector|sectors)\b/i.test(naicsRaw)) {
    return { kind: "heading", text: naicsRaw };
  }

  let naics: string;
  let exceptionLabel: string | null = null;

  const exceptionMatch = naicsRaw.match(NAICS_WITH_EXCEPTION);
  const plainMatch = naicsRaw.match(NAICS_PLAIN);

  if (exceptionMatch) {
    naics = exceptionMatch[1];
    exceptionLabel = exceptionMatch[2];
  } else if (plainMatch) {
    naics = plainMatch[1];
  } else {
    return {
      kind: "malformed",
      reason: `NAICS cell is neither a 6-digit code nor a recognized exception: "${naicsRaw}"`,
      row,
    };
  }

  const title = splitFootnoteRefs(titleRaw);
  const receipts = splitFootnoteRefs(row.receiptsCell);
  const employees = splitFootnoteRefs(row.employeesCell);

  const receiptsValue = parseStandardValue(receipts.text);
  const employeesValue = parseStandardValue(employees.text);

  if (receiptsValue != null && employeesValue != null) {
    return {
      kind: "malformed",
      reason:
        "both receipts and employees columns populated — column extraction is misaligned",
      row,
    };
  }

  // Non-empty cell that failed to parse means we saw something we don't
  // understand. Surface it rather than recording a null threshold that
  // would read downstream as "no standard".
  if (receiptsValue == null && receipts.text) {
    return {
      kind: "malformed",
      reason: `unparseable receipts value: "${receipts.text}"`,
      row,
    };
  }
  if (employeesValue == null && employees.text) {
    return {
      kind: "malformed",
      reason: `unparseable employees value: "${employees.text}"`,
      row,
    };
  }

  const footnoteRefs = Array.from(
    new Set([...title.refs, ...receipts.refs, ...employees.refs]),
  ).sort();

  let measure: SizeStandardMeasure;
  let receiptsMillionsUsd: number | null = null;
  let assetsMillionsUsd: number | null = null;

  if (employeesValue != null) {
    measure = "employees";
  } else if (receiptsValue != null && ASSETS_MARKER.test(titleRaw)) {
    measure = "assets";
    assetsMillionsUsd = receiptsValue;
  } else if (receiptsValue != null) {
    measure = "annual_receipts";
    receiptsMillionsUsd = receiptsValue;
  } else {
    measure = "other";
  }

  return {
    kind: "record",
    record: {
      naics,
      exceptionLabel,
      title: title.text,
      measure,
      receiptsMillionsUsd,
      employees: employeesValue,
      assetsMillionsUsd,
      footnoteRefs,
      raw: {
        naicsCell: row.naicsCell,
        titleCell: row.titleCell,
        receiptsCell: row.receiptsCell,
        employeesCell: row.employeesCell,
      },
    },
  };
}

/** Stable identity for a record: base rows and exceptions never collide. */
export function recordKey(record: {
  naics: string;
  exceptionLabel: string | null;
}): string {
  return record.exceptionLabel
    ? `${record.naics}::${record.exceptionLabel}`
    : record.naics;
}
