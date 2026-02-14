import type { MatchResult } from "./types";

function extractYears(filename: string): number[] {
  const years = new Set<number>();
  // Match 4-digit years (2000-2039) at word boundaries OR surrounded by separators/dots
  // This handles filenames like "1040_John_Smith_2024.pdf" where \b doesn't work
  const re = /(?:^|[^0-9])(20[0-3][0-9])(?:[^0-9]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(filename)) !== null) {
    const y = parseInt(m[1], 10);
    if (y >= 2000 && y <= 2039) years.add(y);
  }
  return Array.from(years).sort((a, b) => b - a);
}

function pickBestDocYear(years: number[]): number | null {
  if (!years.length) return null;
  // prefer most recent
  return years[0];
}

/**
 * Filename matcher v2:
 * - deterministic patterns
 * - extracts years from filename
 * - returns best key + confidence + year metadata
 * - designed to be extended with doc_intel + OCR later
 */
export function matchChecklistKeyFromFilename(filenameRaw: string): MatchResult {
  const filename = (filenameRaw || "").toLowerCase();
  const yearsFound = extractYears(filenameRaw || "");
  const docYear = pickBestDocYear(yearsFound);

  // Word boundary helper: matches start/end of string, whitespace, or common separators
  // Note: \b considers underscore as word char, so we use explicit patterns for abbreviations
  const rules: Array<{ key: string; re: RegExp; confidence: number; reason: string }> = [
    // === Tax Returns ===
    // Form numbers (1040, 1120, 1065) - high confidence
    { key: "IRS_PERSONAL_3Y", re: /(?:^|[\s_\-./])1040(?:[\s_\-./]|\.pdf|$)/i, confidence: 0.85, reason: "Form 1040 (personal tax)" },
    { key: "IRS_BUSINESS_3Y", re: /(?:^|[\s_\-./])(1120s?|1065)(?:[\s_\-./]|\.pdf|$)/i, confidence: 0.85, reason: "Form 1120/1065 (business tax)" },
    // Abbreviations (PTR, BTR) at word boundaries or with separators
    { key: "IRS_PERSONAL_3Y", re: /(?:^|[\s_\-./])ptr(?:[\s_\-./]|\.pdf|$)/i, confidence: 0.85, reason: "PTR abbreviation" },
    { key: "IRS_BUSINESS_3Y", re: /(?:^|[\s_\-./])btr(?:[\s_\-./]|\.pdf|$)/i, confidence: 0.85, reason: "BTR abbreviation" },
    // Descriptive patterns
    { key: "IRS_PERSONAL_3Y", re: /personal[\s_\-]*(income[\s_\-]*)?tax/i, confidence: 0.75, reason: "Personal tax pattern" },
    { key: "IRS_BUSINESS_3Y", re: /business[\s_\-]*tax/i, confidence: 0.75, reason: "Business tax pattern" },

    // === Personal Financial Statement ===
    { key: "PFS_CURRENT", re: /(?:^|[\s_\-./])pfs(?:[\s_\-./]|\.pdf|$)/i, confidence: 0.85, reason: "PFS abbreviation" },
    { key: "PFS_CURRENT", re: /personal[\s_\-]*financial[\s_\-]*statement/i, confidence: 0.8, reason: "Personal Financial Statement" },
    { key: "PFS_CURRENT", re: /(?:^|[\s_\-./])413(?:[\s_\-./]|\.pdf|$)/i, confidence: 0.75, reason: "SBA Form 413" },

    // === Financial Statements ===
    { key: "FIN_STMT_PL_YTD", re: /p[\s_]*[&+][\s_]*l|profit[\s_]*(and|&)[\s_]*loss|income[\s_]*statement|statement[\s_]*of[\s_]*operations/i, confidence: 0.8, reason: "P&L / Income Statement" },
    { key: "FIN_STMT_BS_YTD", re: /balance[\s_]*sheet|statement[\s_]*of[\s_]*financial[\s_]*position/i, confidence: 0.8, reason: "Balance Sheet" },
    { key: "FIN_STMT_PL_YTD", re: /(?:^|[\s_\-./])(ytd|year[\s_\-]*to[\s_\-]*date)(?:[\s_\-./]|\.pdf|$)/i, confidence: 0.65, reason: "YTD financials" },
    { key: "FIN_STMT_PL_YTD", re: /trial[\s_]*balance/i, confidence: 0.62, reason: "Trial balance" },

    // === Bank Statements ===
    { key: "BANK_STMT_3M", re: /bank[\s_]*statement/i, confidence: 0.7, reason: "Bank statement" },
    { key: "BANK_STMT_3M", re: /(?:^|[\s_\-./])stmt(?:[\s_\-./]).*(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|20\d{2})/i, confidence: 0.65, reason: "Statement with date" },

    // === Real Estate Documents ===
    { key: "RENT_ROLL", re: /rent[\s_]*roll|rentroll|tenant[\s_]*schedule/i, confidence: 0.85, reason: "Rent roll" },
    { key: "PROPERTY_T12", re: /(?:^|[\s_\-./])t[\s_\-]?12(?:[\s_\-./]|\.pdf|$)|trailing.*12|operating[\s_]*statement/i, confidence: 0.8, reason: "Operating statement" },
    { key: "LEASES_TOP", re: /\blease\b/i, confidence: 0.6, reason: "Lease document" },
    { key: "PROPERTY_INSURANCE", re: /insurance|dec(?:larations?)?[\s_]*page/i, confidence: 0.7, reason: "Insurance document" },
    { key: "APPRAISAL_IF_AVAILABLE", re: /appraisal|valuation/i, confidence: 0.8, reason: "Appraisal" },
    { key: "REAL_ESTATE_TAX_BILL", re: /property[\s_]*tax|real[\s_]*estate[\s_]*tax|tax[\s_]*bill/i, confidence: 0.75, reason: "Property tax bill" },
  ];

  let best: MatchResult = { matchedKey: null, confidence: 0, reason: "no_match", yearsFound, docYear, source: "filename" };

  for (const r of rules) {
    if (r.re.test(filename) && r.confidence > best.confidence) {
      best = { matchedKey: r.key, confidence: r.confidence, reason: r.reason, yearsFound, docYear, source: "filename" };
    }
  }

  // Boost confidence when a year exists for year-sensitive keys
  if (best.matchedKey && ["IRS_BUSINESS_3Y", "IRS_PERSONAL_3Y"].includes(best.matchedKey)) {
    if (docYear) best.confidence = Math.min(0.95, best.confidence + 0.15);
    else best.confidence = Math.max(0.6, best.confidence - 0.1); // penalize no-year
  }

  // Slight boost when YTD tokens also include a year.
  if (best.matchedKey && ["FIN_STMT_PL_YTD", "FIN_STMT_BS_YTD"].includes(best.matchedKey)) {
    if (docYear) best.confidence = Math.min(0.9, best.confidence + 0.08);
  }

  return best;
}
