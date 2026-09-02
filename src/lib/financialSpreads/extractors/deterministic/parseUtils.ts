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
// IRS form / reference number guard
// ---------------------------------------------------------------------------

/** Well-known IRS form, schedule, and line reference numbers. */
const IRS_REFERENCE_NUMBERS = new Set([
  1040, 1065, 1120, 1125, 1099, 1098,
  4562, 4797, 8825, 8949, 8829, 8995,
  2106, 2441, 3800, 3903, 4684,
  5884, 6198, 6251, 6252, 6765,
  7203, 8283, 8332, 8396, 8582, 8606, 8801, 8839, 8863, 8880, 8889,
  8910, 8936, 8959, 8960, 8962, 990,
  // Form 8990 (business interest expense limitation) — referenced on 1120/1120-S
  // page 1 ("attach Form 8990") right after the words "interest expense".
  8990,
]);

const IRS_CONTEXT_RE = /\b(form|schedule|line|omb|irs|attach|see|ref|page)\b/i;

/**
 * Returns true when a numeric value matches a known IRS form/schedule number
 * AND nearby context confirms it's a reference, not a dollar amount.
 */
export function isLikelyReferenceNumber(value: number, context: string): boolean {
  if (!IRS_REFERENCE_NUMBERS.has(Math.abs(value))) return false;
  return IRS_CONTEXT_RE.test(context);
}

/**
 * Returns true when the raw match string looks like a money token:
 * contains $, commas, parenthetical negatives, decimals, or is long (>= 5 chars of digits).
 */
export function looksLikeMoneyToken(rawMatch: string): boolean {
  if (/\$/.test(rawMatch)) return true;
  if (/,/.test(rawMatch)) return true;
  if (/\([\d,.]+\)/.test(rawMatch)) return true;
  if (/\.\d{1,2}$/.test(rawMatch)) return true;
  const digitsOnly = rawMatch.replace(/[^0-9]/g, "");
  return digitsOnly.length >= 5;
}

// ---------------------------------------------------------------------------
// Labeled amount extraction
// ---------------------------------------------------------------------------

export type LabeledAmountResult = {
  value: number | null;
  snippet: string | null;
  /** The raw numeric token that produced `value` (e.g. "$1,234.56", "8"). */
  raw?: string | null;
};

/**
 * A numeric token as it appears in OCR text (money or bare integer).
 * Accepts both "$(1,234)" and "($1,234)" parenthetical-negative orderings.
 */
const AMOUNT_TOKEN_RE = /\(?-?\$?\(?-?[0-9][0-9,]*(?:\.[0-9]{1,2})?\)?/g;

/**
 * Many extractor label patterns were written as full line matchers that end in
 * their own amount capture, e.g. `/(?:line\s+1c|net\s+sales).*?(\$?[\d,]+(?:\.\d{0,2})?)/i`.
 * When such a pattern is embedded as the LABEL of the labeled-amount regex, the
 * embedded `[\d,]+` swallows the amount and the outer amount group is forced to
 * backtrack onto the last digit — "325,810" became 32581 (trailing digit
 * dropped) and "line 1c | 3 | 997,082" became 3 (the IRS line number).
 *
 * Normalize the label: strip a trailing `.*?(<amount>)` capture and turn any
 * remaining capturing groups into non-capturing ones so group indices are stable.
 */
export function normalizeLabelPatternSource(source: string): string {
  let src = source;

  // Strip a trailing amount capture group `( ... )` whose body is a numeric
  // matcher (contains `\d` or `[0-9]`), together with the gap that precedes it
  // (`.*?`, `\s*`, `\s+`, `[:\s]*`, …). Handles both `.*?(\$?[\d,]+…)` and
  // `[:\s]*(\(?-?\$?\d[\d,]*…)` shapes used across the extractors.
  if (src.endsWith(")")) {
    // Walk back to the `(` that opens the final group (skip escaped parens).
    let depth = 0;
    let open = -1;
    for (let i = src.length - 1; i >= 0; i--) {
      const ch = src[i];
      const escaped = i > 0 && src[i - 1] === "\\";
      if (escaped) continue;
      if (ch === ")") depth++;
      else if (ch === "(") {
        depth--;
        if (depth === 0) {
          open = i;
          break;
        }
      }
    }
    if (open > 0 && src[open + 1] !== "?") {
      const body = src.slice(open + 1, -1);
      const isNumericBody = /\\d|\[0-9\]|\[\\d,\]/.test(body);
      if (isNumericBody) {
        let head = src.slice(0, open);
        // Drop the gap token(s) immediately before the group.
        head = head.replace(/(?:\.\*\?|\\s[*+]?|\[[^\]]*\][*+?]?|\s)+$/, "");
        if (head.length > 0) src = head;
      }
    }
  }

  // Capturing `(` → non-capturing `(?:` (skip escaped parens and existing `(?`).
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "\\") {
      out += ch + (src[i + 1] ?? "");
      i++;
      continue;
    }
    if (ch === "(" && src[i + 1] !== "?") {
      out += "(?:";
      continue;
    }
    out += ch;
  }
  return out;
}

function buildLabelRegex(label: string | RegExp, global: boolean): RegExp {
  const labelPat =
    label instanceof RegExp ? normalizeLabelPatternSource(label.source) : escapeRegex(label);
  let flags = label instanceof RegExp ? label.flags.replace("g", "") : "i";
  if (global) flags += "g";
  return new RegExp(`(${labelPat})`, flags);
}

/**
 * Pick the best numeric token inside a lookahead window that follows a label.
 *
 * Preference order:
 *   1. The first token that LOOKS like money ($, comma grouping, decimals,
 *      parenthetical negative, or 5+ digits). IRS/OCR tables commonly render
 *      the line number BEFORE the amount ("line 1c | 3 | 997,082"); the amount
 *      is the money-looking token, the "3" is the line number.
 *   2. Otherwise the first token that is not an IRS form/schedule reference.
 */
function pickAmountToken(
  window: string,
  context: string,
): { raw: string; value: number; endOffset: number } | null {
  const tokens: Array<{ raw: string; value: number; endOffset: number; money: boolean }> = [];
  const re = new RegExp(AMOUNT_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(window)) !== null) {
    // Trailing list punctuation ("8990," / "1,234.") is not part of the amount
    // and must not make a bare number look comma-grouped.
    const raw = m[0].replace(/[,.]+$/, "");
    if (!raw) continue;
    const value = parseMoney(raw);
    if (value === null) continue;
    const money = looksLikeMoneyToken(raw);
    if (isLikelyReferenceNumber(value, context) && !money) continue;
    tokens.push({ raw, value, endOffset: m.index + raw.length, money });
  }
  if (tokens.length === 0) return null;
  const preferred = tokens.find((t) => t.money) ?? tokens[0];
  return { raw: preferred.raw, value: preferred.value, endOffset: preferred.endOffset };
}

/**
 * Drop-in replacement for `text.match(labelWithAmountCapture)` used by the
 * schedule extractors: returns `[snippet, rawAmountToken]` (same shape the
 * callers read as `m[0]` / `m[1]`) or null. Unlike a raw lazy match, the amount
 * is chosen by findLabeledAmount's token policy, so an IRS line number sitting
 * between the label and the amount ("Distributions | 16 | 12,500") is no longer
 * returned as the amount.
 */
export function matchAmountAfterLabel(
  text: string,
  pattern: RegExp,
  opts?: { maxLookahead?: number; crossLine?: boolean },
): [string, string] | null {
  const r = findLabeledAmount(text, pattern, opts);
  if (r.value === null || !r.raw) return null;
  return [r.snippet ?? r.raw, r.raw];
}

/**
 * Find a dollar amount near a label in text.
 * Searches for `label` followed by a dollar amount within maxLookahead chars.
 *
 * Guards against IRS form/schedule reference numbers being mistaken for amounts.
 *
 * @param text      Full document text
 * @param label     Label string or regex to search for
 * @param opts.maxLookahead  Max chars to look ahead for amount (default 120)
 */
export function findLabeledAmount(
  text: string,
  label: string | RegExp,
  opts?: { maxLookahead?: number; crossLine?: boolean },
): LabeledAmountResult {
  const results = findAllLabeledAmounts(text, label, { ...opts, limit: 1 });
  return results[0] ?? { value: null, snippet: null, raw: null };
}

/**
 * Find ALL occurrences of a labeled amount in text.
 */
export function findAllLabeledAmounts(
  text: string,
  label: string | RegExp,
  opts?: { maxLookahead?: number; crossLine?: boolean; limit?: number },
): LabeledAmountResult[] {
  const maxLook = opts?.maxLookahead ?? 120;
  const re = buildLabelRegex(label, true);
  const results: LabeledAmountResult[] = [];

  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    const labelEnd = m.index + m[0].length;
    let window = text.slice(labelEnd, labelEnd + maxLook);
    if (!opts?.crossLine) {
      const nl = window.search(/[\n\r]/);
      if (nl >= 0) window = window.slice(0, nl);
    }

    // Use a ±40 char window around the label for reference-number context
    // (captures "Form 1065" before the label).
    const ctxStart = Math.max(0, m.index - 40);
    const ctxEnd = Math.min(text.length, labelEnd + window.length + 40);
    const context = text.slice(ctxStart, ctxEnd);

    const picked = pickAmountToken(window, context);
    if (!picked) continue;

    const snippet = (m[0] + window.slice(0, picked.endOffset)).replace(/\s+/g, " ").trim();
    results.push({ value: picked.value, snippet, raw: picked.raw });
    if (opts?.limit && results.length >= opts.limit) break;
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
  // Interim statement headers: "For the six months ended June 30, 2026",
  // "For the 6 months ending 6/30/2026", "For the period ended March 31, 2026".
  // These carry the period END; a "<N> months" prefix also gives the START, so
  // return an ISO range that normalizePeriod() understands. Without this the
  // extractor fell through to the doc-year fallback and stamped a 6-month YTD
  // P&L as the full fiscal year (…-12-31).
  const interim = findInterimPeriodHeader(text);
  if (interim) return interim;

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

  // Fallback: a standalone "Month DD, YYYY" in the document header (balance
  // sheets and P&Ls print the as-of date under the title with no keyword).
  const headerDate = text.slice(0, 600).match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i,
  );
  if (headerDate) {
    const mo = monthNameToNum(headerDate[1]);
    if (mo) return `${headerDate[3]}-${pad2(mo)}-${headerDate[2].padStart(2, "0")}`;
  }

  return null;
}

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12,
};

/**
 * Detect an interim-period header and return an ISO date or ISO range.
 *
 *   "For the six months ended June 30, 2026"     → "2026-01-01 to 2026-06-30"
 *   "For the 3 months ending 3/31/2026"          → "2026-01-01 to 2026-03-31"
 *   "For the period ended September 30, 2025"    → "2025-09-30"
 *   "For the year ended December 31, 2025"       → "2025-01-01 to 2025-12-31"
 *
 * Only the END date is required; the start is derived from "<N> months" or
 * "year" when present. Exported for tests.
 */
export function findInterimPeriodHeader(text: string): string | null {
  const head = text.slice(0, 1500);
  const re =
    /(?:for\s+the\s+)?(?:(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[\s-]+months?|(year)|(?:period|quarter))\s+(?:then\s+)?end(?:ed|ing)\s+(?:on\s+)?((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}[/-]\d{1,2}[/-]\d{4}|\d{4}-\d{2}-\d{2})/i;
  const m = head.match(re);
  if (!m) return null;

  const end = parseLooseDate(m[3]);
  if (!end) return null;

  let months: number | null = null;
  if (m[1]) {
    const w = m[1].toLowerCase();
    months = WORD_NUMBERS[w] ?? Number(w);
    if (!Number.isFinite(months) || months <= 0 || months > 12) months = null;
  } else if (m[2]) {
    months = 12;
  }
  if (months === null) return end;

  // Start = first day of the month `months - 1` months before the end month.
  const [y, mo] = end.split("-").map(Number);
  const startIdx = mo - months; // 0-based month index of the start
  const startY = y + Math.floor(startIdx / 12);
  const startM = ((startIdx % 12) + 12) % 12 + 1;
  return `${startY}-${pad2(startM)}-01 to ${end}`;
}

/** Parse "June 30, 2026" | "6/30/2026" | "2026-06-30" → "2026-06-30". */
function parseLooseDate(raw: string): string | null {
  const s = raw.trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return s;
  const us = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (us) return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const named = s.match(/^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (named) {
    const mo = monthNameToNum(named[1]);
    if (mo) return `${named[3]}-${pad2(mo)}-${named[2].padStart(2, "0")}`;
  }
  return null;
}

/**
 * Derive an as-of / period-end date from an upload's filename, e.g.
 * "IS 6-30-2026 Atlanta Ceramic.pdf" → "2026-06-30", "BS_12.31.2025.pdf" →
 * "2025-12-31". Bankers routinely encode the statement date in the filename
 * when the document body prints none. Exported for tests.
 */
export function findDateInFilename(filename: string | null | undefined): string | null {
  if (!filename) return null;
  const name = filename.replace(/\.[a-z0-9]{2,4}$/i, "");
  const us = name.match(/(?:^|[^\d])(\d{1,2})[-./](\d{1,2})[-./](\d{4})(?!\d)/);
  if (us) {
    const mo = Number(us[1]);
    const d = Number(us[2]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${us[3]}-${pad2(mo)}-${pad2(d)}`;
    }
  }
  const iso = name.match(/(?:^|[^\d])(\d{4})[-._](\d{2})[-._](\d{2})(?!\d)/);
  if (iso) {
    const mo = Number(iso[2]);
    const d = Number(iso[3]);
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }
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
// Period resolution with docYear fallback
// ---------------------------------------------------------------------------

/**
 * Resolve a date string from document text, with docYear fallback.
 * Returns a raw string suitable for `normalizePeriod()`:
 *  - "2024-03-15" (from findDateOnDocument)
 *  - "2024" (from docYear fallback — normalizePeriod handles "2024" → FY2024)
 *  - null (no date found anywhere)
 */
export function resolveDocDate(
  text: string,
  docYear?: number | null,
  opts?: { originalFilename?: string | null },
): string | null {
  const dateStr = findDateOnDocument(text);
  if (dateStr) return dateStr;
  const fromFilename = findDateInFilename(opts?.originalFilename);
  if (fromFilename) return fromFilename;
  if (docYear && docYear >= 1990 && docYear <= 2100) return String(docYear);
  return null;
}

/**
 * Resolve a tax year from document text, with docYear fallback.
 */
export function resolveDocTaxYear(
  text: string,
  docYear?: number | null,
): number | null {
  const fromText = extractTaxYear(text);
  if (fromText) return fromText;
  if (docYear && docYear >= 1990 && docYear <= 2100) return docYear;
  return null;
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
