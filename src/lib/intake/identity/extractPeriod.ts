/**
 * extractPeriod — deterministic period extraction from document text.
 *
 * PURE module: no DB, no IO, no side effects, no imports from other Buddy
 * modules. Patterns are checked in strict priority order; the first match
 * wins for statementType / periodEnd / periodStart, but ALL matches
 * contribute to multi-year detection.
 *
 * @module
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StatementType =
  | "annual"
  | "ytd"
  | "interim"
  | "monthly"
  | "quarterly"
  | "ttm"
  | null;

export type PeriodEvidence = {
  signal: string;
  matchedText: string;
  confidence: number;
};

export type PeriodExtraction = {
  taxYear: number | null;
  taxYearConfidence: number;
  periodStart: string | null;
  periodEnd: string | null;
  statementType: StatementType;
  multiYear: boolean;
  evidence: PeriodEvidence[];
};

// ---------------------------------------------------------------------------
// Month lookup
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

// ---------------------------------------------------------------------------
// Date parsing helper
// ---------------------------------------------------------------------------

/**
 * Parse a human-readable date string into "YYYY-MM-DD" ISO format.
 * Handles:
 *   "December 31, 2024"  → "2024-12-31"
 *   "12/31/2024"         → "2024-12-31"
 *   "12/31/24"           → "2024-12-31"  (assumes 20xx for 2-digit years)
 *
 * Returns null when the input cannot be parsed.
 */
function parseDate(str: string): string | null {
  const s = str.trim();

  // Try "Month DD, YYYY" or "Month DD YYYY"
  const namedMonth =
    /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})$/i;
  const nm = namedMonth.exec(s);
  if (nm) {
    const month = MONTHS[nm[1].toLowerCase()];
    const day = parseInt(nm[2], 10);
    const year = parseInt(nm[3], 10);
    if (month && day >= 1 && day <= 31 && year >= 1900) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Try "MM/DD/YYYY" or "MM/DD/YY"
  const slashDate = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;
  const sd = slashDate.exec(s);
  if (sd) {
    const month = parseInt(sd[1], 10);
    const day = parseInt(sd[2], 10);
    let year = parseInt(sd[3], 10);
    if (year < 100) year += 2000;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1900) {
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

/**
 * Extract a year from an ISO date string "YYYY-MM-DD".
 */
function yearFromIso(iso: string | null): number | null {
  if (!iso) return null;
  const y = parseInt(iso.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

/**
 * Compute the number of days between two ISO date strings.
 */
function daysBetween(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z");
  const db = new Date(b + "T00:00:00Z");
  return Math.round((db.getTime() - da.getTime()) / 86_400_000);
}

/**
 * Derive statementType from a span in days.
 */
function typeFromSpan(days: number): StatementType {
  const abs = Math.abs(days);
  if (abs < 35) return "monthly";
  if (abs < 100) return "quarterly";
  if (abs <= 400) return "annual";
  return "interim";
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function extractPeriod(text: string, filename?: string): PeriodExtraction {
  const window = text.slice(0, 3000);

  // Pre-scan: detect YTD / TTM keywords for statement-type override.
  // These keywords act as semantic modifiers even when a higher-priority
  // date-anchor pattern (e.g. "as of") fires first.
  const hasYtdKeyword = /year[\s-]*to[\s-]*date|(?:^|\s)YTD(?:\s|$)/i.test(window);
  const hasTtmKeyword = /trailing\s+(?:12|twelve)\s+months?|\bTTM\b/i.test(window);

  // Accumulator
  const evidence: PeriodEvidence[] = [];
  const explicitYears: number[] = [];

  let taxYear: number | null = null;
  let taxYearConfidence = 0;
  let periodStart: string | null = null;
  let periodEnd: string | null = null;
  let statementType: StatementType = null;
  let primaryMatched = false;

  // Helper — record an explicit year from a pattern match
  function recordYear(y: number | null): void {
    if (y !== null && Number.isFinite(y)) {
      explicitYears.push(y);
    }
  }

  // Helper — only set primary result fields on first match
  function setPrimary(opts: {
    taxYear?: number | null;
    taxYearConfidence: number;
    periodStart?: string | null;
    periodEnd?: string | null;
    statementType?: StatementType;
  }): void {
    if (primaryMatched) return;
    primaryMatched = true;
    if (opts.taxYear !== undefined) taxYear = opts.taxYear;
    taxYearConfidence = opts.taxYearConfidence;
    if (opts.periodStart !== undefined) periodStart = opts.periodStart;
    if (opts.periodEnd !== undefined) periodEnd = opts.periodEnd;
    if (opts.statementType !== undefined) statementType = opts.statementType;
  }

  // -----------------------------------------------------------------------
  // Pattern 1: "For calendar year <YYYY>" / "For tax year <YYYY>"
  // -----------------------------------------------------------------------
  const p1 = /for\s+(?:the\s+)?(?:calendar|tax)\s+year\s+(20[0-3]\d)/gi;
  let m1: RegExpExecArray | null;
  while ((m1 = p1.exec(window)) !== null) {
    const yr = parseInt(m1[1], 10);
    recordYear(yr);
    evidence.push({
      signal: "calendar_or_tax_year",
      matchedText: m1[0],
      confidence: 0.95,
    });
    setPrimary({
      taxYear: yr,
      taxYearConfidence: 0.95,
      statementType: "annual",
    });
  }

  // -----------------------------------------------------------------------
  // Pattern 2a: "For the year ended <Month DD, YYYY>"
  // -----------------------------------------------------------------------
  const p2a =
    /for\s+the\s+year\s+end(?:ed|ing)\s+((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})/gi;
  let m2a: RegExpExecArray | null;
  while ((m2a = p2a.exec(window)) !== null) {
    const d = parseDate(m2a[1]);
    const yr = yearFromIso(d);
    recordYear(yr);
    evidence.push({
      signal: "for_year_ended",
      matchedText: m2a[0],
      confidence: 0.92,
    });
    setPrimary({
      taxYear: yr,
      taxYearConfidence: 0.92,
      periodEnd: d,
      statementType: "annual",
    });
  }

  // -----------------------------------------------------------------------
  // Pattern 2b: "For the year ended MM/DD/YYYY"
  // -----------------------------------------------------------------------
  const p2b = /for\s+the\s+year\s+end(?:ed|ing)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/gi;
  let m2b: RegExpExecArray | null;
  while ((m2b = p2b.exec(window)) !== null) {
    const d = parseDate(m2b[1]);
    const yr = yearFromIso(d);
    recordYear(yr);
    evidence.push({
      signal: "for_year_ended",
      matchedText: m2b[0],
      confidence: 0.92,
    });
    setPrimary({
      taxYear: yr,
      taxYearConfidence: 0.92,
      periodEnd: d,
      statementType: "annual",
    });
  }

  // -----------------------------------------------------------------------
  // Pattern 3: "beginning <YYYY> and ending <YYYY>"
  // -----------------------------------------------------------------------
  const p3 =
    /(?:tax\s+year\s+)?beginning[\s\S]{0,60}?(20[0-3]\d)[\s\S]{0,60}?and\s+ending[\s\S]{0,60}?(20[0-3]\d)/gi;
  let m3: RegExpExecArray | null;
  while ((m3 = p3.exec(window)) !== null) {
    const beginYr = parseInt(m3[1], 10);
    const endYr = parseInt(m3[2], 10);
    recordYear(beginYr);
    recordYear(endYr);
    evidence.push({
      signal: "beginning_ending",
      matchedText: m3[0],
      confidence: 0.90,
    });
    setPrimary({
      taxYear: beginYr,
      taxYearConfidence: 0.90,
      statementType: "annual",
    });
  }

  // -----------------------------------------------------------------------
  // Pattern 4: "As of <Month DD, YYYY>"
  // -----------------------------------------------------------------------
  const p4 =
    /as\s+of\s+((?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2},?\s+\d{4})/gi;
  let m4: RegExpExecArray | null;
  while ((m4 = p4.exec(window)) !== null) {
    const d = parseDate(m4[1]);
    const yr = yearFromIso(d);
    recordYear(yr);
    evidence.push({
      signal: "as_of",
      matchedText: m4[0],
      confidence: 0.88,
    });
    setPrimary({
      taxYear: yr,
      taxYearConfidence: 0.88,
      periodEnd: d,
      statementType: null,
    });
  }

  // -----------------------------------------------------------------------
  // Pattern 5: "For the period <date> - <date>" / "to" / "through"
  // -----------------------------------------------------------------------
  const p5 =
    /for\s+the\s+period\s+([\w\s,\/]+?)\s*(?:-|to|through)\s*([\w\s,\/]+?\d{4})/gi;
  let m5: RegExpExecArray | null;
  while ((m5 = p5.exec(window)) !== null) {
    const dStart = parseDate(m5[1].trim());
    const dEnd = parseDate(m5[2].trim());
    const yrStart = yearFromIso(dStart);
    const yrEnd = yearFromIso(dEnd);
    recordYear(yrStart);
    recordYear(yrEnd);

    let derivedType: StatementType = null;
    if (dStart && dEnd) {
      const span = daysBetween(dStart, dEnd);
      derivedType = typeFromSpan(span);
    }

    evidence.push({
      signal: "for_period_range",
      matchedText: m5[0],
      confidence: 0.85,
    });
    setPrimary({
      taxYear: yrEnd ?? yrStart,
      taxYearConfidence: 0.85,
      periodStart: dStart,
      periodEnd: dEnd,
      statementType: derivedType,
    });
  }

  // -----------------------------------------------------------------------
  // Pattern 6: "For the month ending/ended <date>"
  // -----------------------------------------------------------------------
  const p6 = /for\s+the\s+month\s+end(?:ing|ed)\s+([\w\s,\/]+\d{4})/gi;
  let m6: RegExpExecArray | null;
  while ((m6 = p6.exec(window)) !== null) {
    const d = parseDate(m6[1].trim());
    const yr = yearFromIso(d);
    recordYear(yr);
    evidence.push({
      signal: "month_ending",
      matchedText: m6[0],
      confidence: 0.85,
    });
    setPrimary({
      taxYear: yr,
      taxYearConfidence: 0.85,
      periodEnd: d,
      statementType: "monthly",
    });
  }

  // -----------------------------------------------------------------------
  // Pattern 7: "For the quarter ending/ended <date>"
  // -----------------------------------------------------------------------
  const p7 = /for\s+the\s+quarter\s+end(?:ing|ed)\s+([\w\s,\/]+\d{4})/gi;
  let m7: RegExpExecArray | null;
  while ((m7 = p7.exec(window)) !== null) {
    const d = parseDate(m7[1].trim());
    const yr = yearFromIso(d);
    recordYear(yr);
    evidence.push({
      signal: "quarter_ending",
      matchedText: m7[0],
      confidence: 0.85,
    });
    setPrimary({
      taxYear: yr,
      taxYearConfidence: 0.85,
      periodEnd: d,
      statementType: "quarterly",
    });
  }

  // -----------------------------------------------------------------------
  // Pattern 8: "Year-to-Date" / "YTD"
  // -----------------------------------------------------------------------
  const p8 = /year[\s-]*to[\s-]*date|(?:^|\s)YTD(?:\s|$)/gi;
  let m8: RegExpExecArray | null;
  while ((m8 = p8.exec(window)) !== null) {
    evidence.push({
      signal: "ytd_keyword",
      matchedText: m8[0],
      confidence: 0.75,
    });
    // YTD doesn't carry a year by itself; if a co-occurring year was already
    // found via an earlier pattern, keep it. Otherwise attempt to pick one up
    // from an "as of" fragment near the YTD keyword.
    setPrimary({
      taxYearConfidence: taxYear !== null ? 0.75 : 0.0,
      statementType: "ytd",
    });
  }

  // -----------------------------------------------------------------------
  // Pattern 9a: "Trailing 12 months ending/ended <date>"
  // -----------------------------------------------------------------------
  const p9a =
    /trailing\s+(?:12|twelve)\s+months?\s+(?:ending|ended)\s+([\w\s,\/]+\d{4})/gi;
  let m9a: RegExpExecArray | null;
  while ((m9a = p9a.exec(window)) !== null) {
    const d = parseDate(m9a[1].trim());
    const yr = yearFromIso(d);
    recordYear(yr);
    evidence.push({
      signal: "ttm_trailing",
      matchedText: m9a[0],
      confidence: 0.85,
    });
    setPrimary({
      taxYear: yr,
      taxYearConfidence: 0.85,
      periodEnd: d,
      statementType: "ttm",
    });
  }

  // -----------------------------------------------------------------------
  // Pattern 9b: standalone "TTM" keyword (weaker)
  // -----------------------------------------------------------------------
  const p9b = /\bTTM\b/g;
  let m9b: RegExpExecArray | null;
  while ((m9b = p9b.exec(window)) !== null) {
    evidence.push({
      signal: "ttm_keyword",
      matchedText: m9b[0],
      confidence: 0.60,
    });
    setPrimary({
      taxYearConfidence: taxYear !== null ? 0.60 : 0.0,
      statementType: "ttm",
    });
  }

  // -----------------------------------------------------------------------
  // Fallback: YTD pattern 8 may co-occur with "as of" that wasn't captured
  // because pattern 4 only matches named months. Handle "as of MM/DD/YYYY"
  // for YTD enrichment specifically.
  // -----------------------------------------------------------------------
  if (statementType === "ytd" && taxYear === null) {
    // Try to pick up a year from a nearby "as of" with slash date
    const ytdDateFallback = /as\s+of\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/i;
    const mf = ytdDateFallback.exec(window);
    if (mf) {
      const d = parseDate(mf[1]);
      const yr = yearFromIso(d);
      if (yr) {
        taxYear = yr;
        taxYearConfidence = 0.75;
        periodEnd = d;
        recordYear(yr);
      }
    }
  }

  // -----------------------------------------------------------------------
  // Fallback: no primary pattern matched → filename or weak text year
  // -----------------------------------------------------------------------
  if (!primaryMatched) {
    // Filename year
    if (filename) {
      const fnYearRe = /(20[0-3]\d)/;
      const fm = fnYearRe.exec(filename);
      if (fm) {
        taxYear = parseInt(fm[1], 10);
        taxYearConfidence = 0.60;
        evidence.push({
          signal: "filename_year",
          matchedText: fm[0],
          confidence: 0.60,
        });
      }
    }

    // Weak text year (first 500 chars, most recent)
    if (taxYear === null) {
      const weakWindow = text.slice(0, 500);
      const weakRe = /\b(20[0-3]\d)\b/g;
      let weakMatch: RegExpExecArray | null;
      let bestYear = 0;
      while ((weakMatch = weakRe.exec(weakWindow)) !== null) {
        const y = parseInt(weakMatch[1], 10);
        if (y > bestYear) bestYear = y;
      }
      if (bestYear > 0) {
        taxYear = bestYear;
        taxYearConfidence = 0.50;
        evidence.push({
          signal: "weak_text_year",
          matchedText: String(bestYear),
          confidence: 0.50,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Post-processing: YTD / TTM keyword overrides statementType.
  // When "Year-to-Date as of Sept 30, 2025" fires pattern 4 (as_of) as
  // the primary date anchor, the YTD keyword still classifies the document
  // as YTD rather than leaving statementType null.
  // -----------------------------------------------------------------------
  if (hasYtdKeyword && statementType !== "ytd") {
    statementType = "ytd";
    if (taxYearConfidence > 0 && taxYearConfidence < 0.75) {
      taxYearConfidence = 0.75;
    }
  } else if (hasTtmKeyword && statementType !== "ttm") {
    // Only override if no stronger classification was already set by
    // patterns 1-7 (annual, monthly, quarterly).
    if (statementType === null) {
      statementType = "ttm";
    }
  }

  // -----------------------------------------------------------------------
  // Multi-year detection
  // -----------------------------------------------------------------------
  const distinctYears = new Set(explicitYears);
  const multiYear = distinctYears.size > 1;

  return {
    taxYear,
    taxYearConfidence,
    periodStart,
    periodEnd,
    statementType,
    multiYear,
    evidence,
  };
}
