/**
 * Deterministic text-parsing primitives for financial document extraction.
 *
 * Pure functions — no server imports, no network, no LLMs.
 * Modeled after src/lib/intel/extractors/sourcesUses.ts patterns.
 */

// ---------------------------------------------------------------------------
// Money parsing
// ---------------------------------------------------------------------------

/**
 * Parse a dollar-amount string into a number.
 * Handles: "$1,234.56", "(1,234.56)" (negative), "1234", "-$5,000"
 */
export function parseMoney(raw: string): number | null {
  if (!raw || typeof raw !== "string") return null;
  let cleaned = raw
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();

  // Handle parenthetical negatives: (1234.56) → -1234.56
  const parenMatch = cleaned.match(/^\(([^)]+)\)$/);
  if (parenMatch) {
    cleaned = `-${parenMatch[1]}`;
  }

  // Remove trailing dash negatives: 1234- → -1234
  if (cleaned.endsWith("-") && !cleaned.startsWith("-")) {
    cleaned = `-${cleaned.slice(0, -1)}`;
  }

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Labeled amount extraction
// ---------------------------------------------------------------------------

export type LabeledAmountResult = {
  value: number | null;
  snippet: string | null;
};

/**
 * Find a dollar amount near a label in text.
 * Searches for `label` followed by a dollar amount within maxLookahead chars.
 *
 * @param text      Full document text
 * @param label     Label string or regex to search for
 * @param opts.maxLookahead  Max chars to look ahead for amount (default 120)
 */
export function findLabeledAmount(
  text: string,
  label: string | RegExp,
  opts?: { maxLookahead?: number },
): LabeledAmountResult {
  const maxLook = opts?.maxLookahead ?? 120;
  const labelPat =
    label instanceof RegExp ? label.source : escapeRegex(label);
  const flags = label instanceof RegExp ? label.flags.replace("g", "") : "i";

  // Match label, then capture a dollar amount within maxLookahead chars
  const re = new RegExp(
    `(${labelPat})[^\\n\\r]{0,${maxLook}}?(\\$?\\(?-?[0-9][0-9,]*(?:\\.[0-9]{1,2})?\\)?)`,
    flags,
  );
  const m = text.match(re);
  if (!m) return { value: null, snippet: null };

  const snippet = m[0].replace(/\s+/g, " ").trim();
  return { value: parseMoney(m[2]), snippet };
}

/**
 * Find ALL occurrences of a labeled amount in text.
 */
export function findAllLabeledAmounts(
  text: string,
  label: string | RegExp,
  opts?: { maxLookahead?: number },
): LabeledAmountResult[] {
  const maxLook = opts?.maxLookahead ?? 120;
  const labelPat =
    label instanceof RegExp ? label.source : escapeRegex(label);
  const flags = label instanceof RegExp
    ? (label.flags.includes("g") ? label.flags : label.flags + "g")
    : "gi";

  const re = new RegExp(
    `(${labelPat})[^\\n\\r]{0,${maxLook}}?(\\$?\\(?-?[0-9][0-9,]*(?:\\.[0-9]{1,2})?\\)?)`,
    flags,
  );

  const results: LabeledAmountResult[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const snippet = m[0].replace(/\s+/g, " ").trim();
    const value = parseMoney(m[2]);
    if (value !== null) {
      results.push({ value, snippet });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Table parsing from OCR text
// ---------------------------------------------------------------------------

export type ParsedTable = {
  headers: string[];
  rows: string[][];
};

/**
 * Parse a text-based table from OCR output.
 *
 * Strategy: find lines that look tabular (multiple whitespace-separated columns),
 * use the first such line as headers, and subsequent lines as rows.
 *
 * @param text           Full document text (or relevant section)
 * @param headerPattern  Regex to identify the header row
 */
export function parseTable(
  text: string,
  headerPattern: RegExp,
): ParsedTable | null {
  const lines = text.split(/\n/);

  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (headerPattern.test(lines[i])) {
      headerIdx = i;
      break;
    }
  }

  if (headerIdx < 0) return null;

  const headerLine = lines[headerIdx];
  const headers = splitTableRow(headerLine);
  if (headers.length < 2) return null;

  const rows: string[][] = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Stop at common table-end markers
    if (/^[-=]{3,}$/.test(line)) continue;
    if (/^(total|subtotal|grand\s+total)/i.test(line)) {
      // Include totals rows
      rows.push(splitTableRow(lines[i]));
      continue;
    }

    const cells = splitTableRow(lines[i]);
    // Require at least 2 cells to be considered a data row
    if (cells.length < 2) break;
    rows.push(cells);
  }

  return { headers, rows };
}

/**
 * Split a table row into cells.
 * Uses 2+ whitespace as delimiter (tabs or multiple spaces).
 */
function splitTableRow(line: string): string[] {
  return line
    .trim()
    .split(/\t|\s{2,}/)
    .map((c) => c.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------

/**
 * Extract a prominent date from document text.
 * Looks for common patterns: "As of MM/DD/YYYY", "Date: MM/DD/YYYY",
 * "Statement Date", "Report Date", etc.
 *
 * Returns YYYY-MM-DD or null.
 */
export function findDateOnDocument(text: string): string | null {
  // ISO format: 2024-01-15
  const isoMatch = text.match(
    /(?:as\s+of|date|effective|period\s+end(?:ing)?)[:\s]*(\d{4}-\d{2}-\d{2})/i,
  );
  if (isoMatch) return isoMatch[1];

  // US format: 01/15/2024 or 1/15/2024
  const usMatch = text.match(
    /(?:as\s+of|date|effective|period\s+end(?:ing)?)[:\s]*(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})/i,
  );
  if (usMatch) {
    const m = usMatch[1].padStart(2, "0");
    const d = usMatch[2].padStart(2, "0");
    return `${usMatch[3]}-${m}-${d}`;
  }

  // "Month DD, YYYY" or "Month YYYY"
  const monthMatch = text.match(
    /(?:as\s+of|date|effective)[:\s]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(\d{1,2})?,?\s*(\d{4})/i,
  );
  if (monthMatch) {
    const mo = monthNameToNum(monthMatch[1]);
    if (mo) {
      const day = monthMatch[2] ? monthMatch[2].padStart(2, "0") : "01";
      return `${monthMatch[3]}-${String(mo).padStart(2, "0")}-${day}`;
    }
  }

  // Fallback: any YYYY-MM-DD in the first 500 chars
  const fallback = text.slice(0, 500).match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (fallback) return fallback[1];

  return null;
}

/**
 * Extract a 4-digit tax year from text.
 * Looks near "Tax Year", "Fiscal Year", "Form 1040", etc.
 */
export function extractTaxYear(text: string): number | null {
  const patterns = [
    /tax\s+(?:year|period)[:\s]*(\d{4})/i,
    /fiscal\s+year[:\s]*(\d{4})/i,
    /for\s+(?:the\s+)?(?:tax\s+)?year\s+(?:ended?\s+)?(?:\w+\s+\d{1,2},?\s+)?(\d{4})/i,
    /form\s+\d{3,4}\w?\s.*?(\d{4})/i,
    /calendar\s+year\s+(\d{4})/i,
    /(?:fy|FY)\s*(\d{4})/,
  ];

  for (const pat of patterns) {
    const m = text.match(pat);
    if (m) {
      const year = Number(m[1]);
      if (year >= 1990 && year <= 2100) return year;
    }
  }

  return null;
}

/**
 * Parse column headers into period objects.
 * Handles: "Jan 2024", "2024-01", "FY2023", "TTM", "Q3 2024", "2023"
 */
export function extractPeriodFromHeaders(
  headers: string[],
): Array<{ label: string; start: string | null; end: string | null }> {
  return headers.map((h) => {
    const label = h.trim();

    // Month-Year: "Jan 2024", "January 2024"
    const monthYear = label.match(
      /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(\d{4})$/i,
    );
    if (monthYear) {
      const mo = monthNameToNum(monthYear[1]);
      if (mo) {
        const y = Number(monthYear[2]);
        const start = `${y}-${pad2(mo)}-01`;
        const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
        const end = `${y}-${pad2(mo)}-${pad2(lastDay)}`;
        return { label, start, end };
      }
    }

    // YYYY-MM: "2024-01"
    const ym = label.match(/^(\d{4})-(\d{2})$/);
    if (ym) {
      const y = Number(ym[1]);
      const m = Number(ym[2]);
      const start = `${y}-${pad2(m)}-01`;
      const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
      const end = `${y}-${pad2(m)}-${pad2(lastDay)}`;
      return { label, start, end };
    }

    // Quarter: "Q3 2024"
    const qMatch = label.match(/^Q(\d)\s+(\d{4})$/i);
    if (qMatch) {
      const q = Number(qMatch[1]);
      const y = Number(qMatch[2]);
      if (q >= 1 && q <= 4) {
        const startMonth = (q - 1) * 3 + 1;
        const endMonth = q * 3;
        const start = `${y}-${pad2(startMonth)}-01`;
        const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
        const end = `${y}-${pad2(endMonth)}-${pad2(lastDay)}`;
        return { label, start, end };
      }
    }

    // FY or plain year: "FY2023", "2023"
    const fyMatch = label.match(/^(?:FY\s*)?(\d{4})$/i);
    if (fyMatch) {
      const y = Number(fyMatch[1]);
      return { label, start: `${y}-01-01`, end: `${y}-12-31` };
    }

    // TTM, YTD — aggregate labels
    if (/^(TTM|YTD|PY_YTD|Annual|Total)$/i.test(label)) {
      return { label, start: null, end: null };
    }

    return { label, start: null, end: null };
  });
}

// ---------------------------------------------------------------------------
// IRS form detection
// ---------------------------------------------------------------------------

export type IrsFormType =
  | "1040"
  | "1120"
  | "1120S"
  | "1065"
  | "SCHEDULE_C"
  | "SCHEDULE_E"
  | "K1"
  | "UNKNOWN";

/**
 * Detect which IRS form type is present in the document text.
 */
export function detectIrsFormType(text: string): IrsFormType {
  const upper = text.slice(0, 2000).toUpperCase();

  if (/FORM\s+1120[\s-]?S/i.test(upper)) return "1120S";
  if (/FORM\s+1120\b/.test(upper) && !/1120[\s-]?S/.test(upper)) return "1120";
  if (/FORM\s+1065\b/.test(upper)) return "1065";
  if (/SCHEDULE\s+K[\s-]?1\b/.test(upper)) return "K1";
  if (/SCHEDULE\s+C\b/.test(upper)) return "SCHEDULE_C";
  if (/SCHEDULE\s+E\b/.test(upper)) return "SCHEDULE_E";
  if (/FORM\s+1040\b/.test(upper)) return "1040";

  // Fallback: look for form numbers in first 500 chars
  if (/\b1120[\s-]?S\b/.test(upper.slice(0, 500))) return "1120S";
  if (/\b1120\b/.test(upper.slice(0, 500))) return "1120";
  if (/\b1065\b/.test(upper.slice(0, 500))) return "1065";
  if (/\b1040\b/.test(upper.slice(0, 500))) return "1040";

  return "UNKNOWN";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function monthNameToNum(name: string): number | null {
  const map: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  };
  return map[name.slice(0, 3).toLowerCase()] ?? null;
}
