import type { MatchResult } from "./types";

/**
 * Filename matcher v1:
 * - deterministic patterns
 * - returns best key + confidence
 * - designed to be extended with doc_intel + OCR later
 */
export function matchChecklistKeyFromFilename(filenameRaw: string): MatchResult {
  const filename = (filenameRaw || "").toLowerCase();

  const rules: Array<{ key: string; re: RegExp; confidence: number; reason: string }> = [
    { key: "IRS_BUSINESS_2Y", re: /\b(1120|1120s|1065|business\s*tax|btr)\b.*\b(2023|2022|2024)\b/i, confidence: 0.8, reason: "Business return pattern" },
    { key: "IRS_PERSONAL_2Y", re: /\b(1040|personal\s*tax|ptr)\b.*\b(2023|2022|2024)\b/i, confidence: 0.85, reason: "Personal return pattern" },
    { key: "PFS_CURRENT", re: /\b(pfs|personal\s*financial\s*statement|413)\b/i, confidence: 0.8, reason: "PFS pattern" },
    { key: "FIN_STMT_YTD", re: /\b(ytd|year[-\s]*to[-\s]*date|trial\s*balance|p\&l|income\s*statement)\b/i, confidence: 0.7, reason: "YTD financials pattern" },
    { key: "BANK_STMT_3M", re: /\b(bank\s*statement|stmt)\b.*\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|2024|2023|2022)\b/i, confidence: 0.65, reason: "Bank stmt pattern" },
    { key: "BTR_2Y", re: /\b(btr)\b.*\b(2023|2022|2024)\b/i, confidence: 0.9, reason: "Explicit BTR" },
    { key: "RENT_ROLL", re: /\b(rent\s*roll|rentroll|tenant\s*schedule)\b/i, confidence: 0.85, reason: "Rent roll pattern" },
    { key: "PROPERTY_T12", re: /\b(t12|t-12|trailing.*12|operating\s*statement)\b/i, confidence: 0.75, reason: "T12 pattern" },
    { key: "LEASES_TOP", re: /\b(lease|tenant\s*lease)\b/i, confidence: 0.6, reason: "Lease pattern" },
    { key: "PROPERTY_INSURANCE", re: /\b(insurance|dec\s*page|declarations?\s*page)\b/i, confidence: 0.7, reason: "Insurance pattern" },
    { key: "APPRAISAL_IF_AVAILABLE", re: /\b(appraisal|valuation)\b/i, confidence: 0.8, reason: "Appraisal pattern" },
    { key: "REAL_ESTATE_TAX_BILL", re: /\b(property\s*tax|real\s*estate\s*tax|tax\s*bill)\b/i, confidence: 0.75, reason: "Property tax pattern" },
  ];

  let best: MatchResult = { matchedKey: null, confidence: 0, reason: "no_match" };

  for (const r of rules) {
    if (r.re.test(filename) && r.confidence > best.confidence) {
      best = { matchedKey: r.key, confidence: r.confidence, reason: r.reason };
    }
  }

  return best;
}
