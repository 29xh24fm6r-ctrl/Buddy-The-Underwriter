/**
 * AR Aging Table Extractor
 *
 * Pure module — no DB, no IO, no server-only imports.
 *
 * Normalizes AR aging documents into the table shape that
 * `parseARAgingTable()` (arCollateralProcessor) consumes:
 *
 *   [{ rows: [
 *       ["Customer", "Current", "1-30", "31-60", "61-90", "91+", "Total"],
 *       ["Affinity Cellular", "123.45", "0", "0", "0", "0", "123.45"],
 *       ...
 *   ]}]
 *
 * Strategy:
 *   1. Prefer native extracted tables when present.
 *   2. Otherwise, reconstruct rows from OCR/plain text.
 *   3. Refuse to emit tables for AP (accounts payable / vendor) aging
 *      reports unless AR signals clearly dominate.
 */

export type ArAgingTable = {
  rows: string[][];
  source: "native_table" | "text_reconstruction";
  confidence: number;
};

export type ArAgingExtractionInput = {
  text?: string | null;
  pages?: unknown;
  tables?: unknown;
  fields?: unknown;
  filename?: string | null;
};

export type ArAgingExtractionResult = {
  tables: ArAgingTable[];
  fields: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
};

const HEADER_KEYWORDS = {
  customer: /(customer|client|account\s*name|debtor)/i,
  current: /(current|not\s*due|0\s*-\s*30)/i,
  d30: /(1\s*-\s*30|^30(\s*days?)?$|^30\b)/i,
  d60: /(31\s*-\s*60|^60(\s*days?)?$|^60\b)/i,
  d90: /(61\s*-\s*90|^90(\s*days?)?$|^90\b)/i,
  d120: /(over\s*90|>\s*90|91\+|120\+|over\s*120|>\s*120|^120(\s*days?)?$)/i,
  total: /^total\b|total\s*amount|total\s*due|^balance\b/i,
};

const AP_SIGNALS = [
  /accounts\s*payable\s*aging/i,
  /\bap\s*aging\b/i,
  /vendor\s*aging/i,
  /supplier\s*aging/i,
  /payable.{0,30}aging/i,
];

const AR_SIGNALS = [
  /accounts\s*receivable\s*aging/i,
  /\bar\s*aging\b/i,
  /receivable.{0,30}aging/i,
  /customer\s*aging/i,
  /aged\s*receivables/i,
];

const CURRENCY_TOKEN = /\(\s*\$?-?[\d,]+(?:\.\d{1,2})?\s*\)|-?\$?[\d,]+(?:\.\d{1,2})?|\s-\s|—/g;

/**
 * Detect AP aging documents so we don't reconstruct them as AR.
 *
 * Returns "ap" only if AP signals are present and AR signals do not dominate.
 */
function detectAgingType(text: string): "ar" | "ap" | "unknown" {
  if (!text) return "unknown";
  const apHits = AP_SIGNALS.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  const arHits = AR_SIGNALS.reduce((n, re) => n + (re.test(text) ? 1 : 0), 0);
  if (apHits > 0 && arHits === 0) return "ap";
  if (apHits > arHits && apHits >= 1) return "ap";
  if (arHits > 0) return "ar";
  return "unknown";
}

function normalizeNativeTables(
  raw: unknown,
): { tables: ArAgingTable[]; nativeCount: number } {
  if (!Array.isArray(raw) || raw.length === 0) return { tables: [], nativeCount: 0 };

  const out: ArAgingTable[] = [];
  for (const t of raw) {
    if (!t || typeof t !== "object") continue;
    const rawRows =
      (t as any).rows ?? (t as any).cells ?? (t as any).data ?? null;
    if (!Array.isArray(rawRows) || rawRows.length < 2) continue;

    const rows: string[][] = [];
    for (const r of rawRows) {
      if (!Array.isArray(r)) continue;
      rows.push(r.map((cell: unknown) => stringifyCell(cell)));
    }
    if (rows.length < 2) continue;

    if (!looksLikeArAgingHeader(rows[0])) continue;

    out.push({ rows, source: "native_table", confidence: 0.95 });
  }
  return { tables: out, nativeCount: out.length };
}

function stringifyCell(cell: unknown): string {
  if (cell == null) return "";
  if (typeof cell === "string") return cell.trim();
  if (typeof cell === "number") return String(cell);
  if (typeof cell === "object") {
    const v = (cell as any).text ?? (cell as any).value ?? (cell as any).content;
    if (v != null) return String(v).trim();
    return "";
  }
  return String(cell);
}

function looksLikeArAgingHeader(row: string[]): boolean {
  const lowered = row.map((c) => c.toLowerCase().trim());
  let bucketHits = 0;
  let hasCustomer = false;
  for (const cell of lowered) {
    if (!hasCustomer && HEADER_KEYWORDS.customer.test(cell)) hasCustomer = true;
    if (HEADER_KEYWORDS.current.test(cell)) bucketHits++;
    if (HEADER_KEYWORDS.d30.test(cell)) bucketHits++;
    if (HEADER_KEYWORDS.d60.test(cell)) bucketHits++;
    if (HEADER_KEYWORDS.d90.test(cell)) bucketHits++;
    if (HEADER_KEYWORDS.d120.test(cell)) bucketHits++;
  }
  return hasCustomer && bucketHits >= 3;
}

// ─── Text reconstruction ─────────────────────────────────────────────────────

type HeaderShape = {
  lineIndex: number;
  columns: Array<keyof typeof HEADER_KEYWORDS>;
  raw: string[];
};

/**
 * Find a line that looks like an AR aging header. Returns the column ordering
 * we recognize (e.g. ["customer","current","d30","d60","d90","d120","total"])
 * or null if no header is found.
 */
function findHeaderLine(lines: string[]): HeaderShape | null {
  let best: HeaderShape | null = null;
  let bestScore = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || line.length < 8) continue;
    const tokens = splitHeaderTokens(line);
    if (tokens.length < 4) continue;

    const cols: Array<keyof typeof HEADER_KEYWORDS> = [];
    let hasCustomer = false;
    let bucketHits = 0;
    for (const tok of tokens) {
      const matched = matchHeaderKey(tok);
      cols.push(matched);
      if (matched === "customer") hasCustomer = true;
      if (matched === "current" || matched === "d30" || matched === "d60" || matched === "d90" || matched === "d120") {
        bucketHits++;
      }
    }
    if (!hasCustomer || bucketHits < 3) continue;

    const score = bucketHits + (cols.includes("total") ? 1 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = { lineIndex: i, columns: cols, raw: tokens };
    }
  }
  return best;
}

function splitHeaderTokens(line: string): string[] {
  // Split on 2+ spaces or tab
  return line
    .split(/\t|\s{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function matchHeaderKey(tok: string): keyof typeof HEADER_KEYWORDS {
  const s = tok.toLowerCase().trim();
  // Specific bucket keys before generic ones (substring-dispatch ordering)
  if (HEADER_KEYWORDS.d120.test(s)) return "d120";
  if (HEADER_KEYWORDS.d90.test(s)) return "d90";
  if (HEADER_KEYWORDS.d60.test(s)) return "d60";
  if (HEADER_KEYWORDS.d30.test(s)) return "d30";
  if (HEADER_KEYWORDS.current.test(s)) return "current";
  if (HEADER_KEYWORDS.total.test(s)) return "total";
  if (HEADER_KEYWORDS.customer.test(s)) return "customer";
  return "customer"; // unknown column — kept as a placeholder; only counted slots matter
}

/**
 * Extract trailing numeric tokens (currency-formatted) from a line. Returns the
 * leading text (customer name) and an ordered list of normalized number strings.
 */
function splitDataRow(
  line: string,
  expectedNumericCount: number,
): { name: string; numbers: string[] } | null {
  if (!line) return null;
  const trimmed = line.trim();
  if (!trimmed) return null;

  // Pull out all numeric / currency-shaped tokens with their positions
  const matches: Array<{ value: string; index: number; length: number }> = [];
  CURRENCY_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CURRENCY_TOKEN.exec(trimmed)) !== null) {
    matches.push({ value: m[0], index: m.index, length: m[0].length });
  }
  if (matches.length < expectedNumericCount) return null;

  // Take the LAST `expectedNumericCount` matches — name is everything before the first kept match
  const kept = matches.slice(-expectedNumericCount);
  const firstKept = kept[0];
  const name = trimmed.slice(0, firstKept.index).trim();
  if (!name) return null;
  // Customer name shouldn't itself look like a pure number / total/footer marker
  if (/^\d/.test(name) && !/[a-z]/i.test(name)) return null;

  return { name, numbers: kept.map((k) => normalizeNumberToken(k.value)) };
}

function normalizeNumberToken(tok: string): string {
  const s = tok.trim();
  if (s === "-" || s === "—") return "0";
  // Parens = negative
  const parens = /^\(\s*\$?(.+?)\s*\)$/.exec(s);
  const inner = parens ? `-${parens[1]}` : s;
  // Strip $, whitespace, AND commas (thousands separator)
  return inner.replace(/[$,\s]/g, "");
}

function isFooterLine(name: string): boolean {
  return /\b(grand\s*total|total\b|sub\s*total)\b/i.test(name);
}

function reconstructFromText(text: string): {
  table: ArAgingTable | null;
  diagnostics: Record<string, unknown>;
} {
  const diagnostics: Record<string, unknown> = {};
  const stripped = text.replace(/\[Page\s+\d+\]/gi, "\n");
  const lines = stripped
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+$/g, ""))
    .filter((l) => l.length > 0);

  const header = findHeaderLine(lines);
  if (!header) {
    diagnostics.reason = "no_header_found";
    return { table: null, diagnostics };
  }

  // How many numeric columns to expect per data row
  const numericCols = header.columns.filter(
    (c) => c === "current" || c === "d30" || c === "d60" || c === "d90" || c === "d120" || c === "total",
  ).length;
  if (numericCols < 3) {
    diagnostics.reason = "insufficient_numeric_columns";
    diagnostics.numericCols = numericCols;
    return { table: null, diagnostics };
  }

  // Build a normalized header for the parser downstream — emit ONLY the
  // canonical AR aging columns we care about, in the order parseARAgingTable expects.
  const normalizedHeader: string[] = [];
  const slotOrder: Array<keyof typeof HEADER_KEYWORDS> = [];
  if (header.columns.includes("customer")) {
    normalizedHeader.push("Customer");
    slotOrder.push("customer");
  } else {
    return { table: null, diagnostics: { reason: "missing_customer_column" } };
  }
  for (const slot of ["current", "d30", "d60", "d90", "d120", "total"] as const) {
    if (header.columns.includes(slot)) {
      normalizedHeader.push(slotLabel(slot));
      slotOrder.push(slot);
    }
  }

  const numericSlotCount = slotOrder.length - 1; // minus customer
  const dataRows: string[][] = [];
  let parsedRows = 0;
  let footerSkipped = 0;

  for (let i = header.lineIndex + 1; i < lines.length; i++) {
    const line = lines[i];
    // Stop if the line starts a new section (another header) or a clear page break
    if (looksLikeArAgingHeaderLine(line)) break;

    const row = splitDataRow(line, numericSlotCount);
    if (!row) continue;

    if (isFooterLine(row.name)) {
      footerSkipped++;
      // Footer/grand-total lines tell us we've reached end of data; stop.
      break;
    }

    // Build the row in slotOrder order
    const cells: string[] = [row.name];
    for (let n = 0; n < row.numbers.length && cells.length < normalizedHeader.length; n++) {
      cells.push(row.numbers[n]);
    }
    while (cells.length < normalizedHeader.length) cells.push("0");

    dataRows.push(cells);
    parsedRows++;
  }

  diagnostics.parsedRows = parsedRows;
  diagnostics.footerSkipped = footerSkipped;
  diagnostics.headerLineIndex = header.lineIndex;

  if (dataRows.length === 0) {
    diagnostics.reason = "no_data_rows_parsed";
    return { table: null, diagnostics };
  }

  return {
    table: {
      rows: [normalizedHeader, ...dataRows],
      source: "text_reconstruction",
      confidence: parsedRows >= 3 ? 0.7 : 0.55,
    },
    diagnostics,
  };
}

function slotLabel(slot: "current" | "d30" | "d60" | "d90" | "d120" | "total"): string {
  switch (slot) {
    case "current":
      return "Current";
    case "d30":
      return "1-30";
    case "d60":
      return "31-60";
    case "d90":
      return "61-90";
    case "d120":
      return "91+";
    case "total":
      return "Total";
  }
}

function looksLikeArAgingHeaderLine(line: string): boolean {
  const tokens = splitHeaderTokens(line);
  if (tokens.length < 4) return false;
  let cust = false;
  let buckets = 0;
  for (const t of tokens) {
    const k = matchHeaderKey(t);
    if (k === "customer" && HEADER_KEYWORDS.customer.test(t.toLowerCase())) cust = true;
    if (k === "current" || k === "d30" || k === "d60" || k === "d90" || k === "d120") buckets++;
  }
  return cust && buckets >= 3;
}

// ─── Date detection ──────────────────────────────────────────────────────────

const DATE_LABELS = /(as\s*of|report\s*date|period\s*end(?:ing)?|statement\s*date|aging\s*date)\s*[:\-]?\s*/i;
const ISO_DATE = /(\d{4}-\d{2}-\d{2})/;
const US_DATE = /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/;
const MONTH_DATE = /(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/i;

function detectAsOfDate(text: string, fields?: unknown): string | null {
  const fromFields = pickFieldDate(fields);
  if (fromFields) return fromFields;

  if (!text) return null;

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (!DATE_LABELS.test(line)) continue;
    const iso = parseAnyDate(line);
    if (iso) return iso;
  }
  // Fallback: any ISO date in the first 30 lines
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    const iso = ISO_DATE.exec(lines[i]);
    if (iso) return iso[1];
  }
  return null;
}

function pickFieldDate(fields: unknown): string | null {
  if (!fields || typeof fields !== "object") return null;
  const f = fields as Record<string, unknown>;
  for (const key of ["as_of_date", "report_date", "statement_date", "aging_date"]) {
    const v = f[key];
    if (typeof v === "string") {
      const parsed = parseAnyDate(v);
      if (parsed) return parsed;
    }
  }
  return null;
}

function parseAnyDate(s: string): string | null {
  const iso = ISO_DATE.exec(s);
  if (iso) return iso[1];
  const us = US_DATE.exec(s);
  if (us) {
    const mm = pad2(us[1]);
    const dd = pad2(us[2]);
    let yyyy = us[3];
    if (yyyy.length === 2) yyyy = `20${yyyy}`;
    return `${yyyy}-${mm}-${dd}`;
  }
  const mo = MONTH_DATE.exec(s);
  if (mo) {
    const monthIdx = MONTHS.indexOf(mo[1].toLowerCase().slice(0, 3));
    if (monthIdx >= 0) {
      return `${mo[3]}-${pad2(String(monthIdx + 1))}-${pad2(mo[2])}`;
    }
  }
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function pad2(n: string): string {
  const s = String(parseInt(n, 10));
  return s.length === 1 ? `0${s}` : s;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function extractArAgingTables(
  input: ArAgingExtractionInput,
): ArAgingExtractionResult {
  const text = typeof input.text === "string" ? input.text : "";
  const diagnostics: Record<string, unknown> = {};

  // 1. AP-aging negative guard
  const aging = detectAgingType(`${text}\n${input.filename ?? ""}`);
  diagnostics.aging_type = aging;
  if (aging === "ap") {
    return {
      tables: [],
      fields: {},
      diagnostics: { ...diagnostics, reason: "rejected_ap_aging" },
    };
  }

  // 2. Native tables first
  const native = normalizeNativeTables(input.tables);
  diagnostics.native_table_count = native.nativeCount;

  let tables: ArAgingTable[] = native.tables;

  // 3. Text reconstruction fallback
  if (tables.length === 0) {
    const recon = reconstructFromText(text);
    diagnostics.reconstruction = recon.diagnostics;
    if (recon.table) tables = [recon.table];
  }

  // 4. Detect as-of date for downstream
  const asOf = detectAsOfDate(text, input.fields);
  const fields: Record<string, unknown> = {};
  if (asOf) {
    fields.as_of_date = asOf;
    fields.report_date = asOf;
  }

  diagnostics.tables_emitted = tables.length;

  return { tables, fields, diagnostics };
}
