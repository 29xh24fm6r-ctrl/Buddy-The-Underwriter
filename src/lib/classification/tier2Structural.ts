/**
 * Tier 2 — Structural Pattern Engine
 *
 * Layout intelligence without LLM. Confidence 0.75–0.89.
 * Tier 2 cannot override Tier 1.
 *
 * Pure function — no server-only, no DB, no API.
 *
 * INVARIANT: Operating statements map to INCOME_STATEMENT, never T12.
 * T12 is not a required universal document type.
 */

import type { NormalizedDocument, Tier2Result, EvidenceItem } from "./types";

// ---------------------------------------------------------------------------
// Structural Pattern Definitions
// ---------------------------------------------------------------------------

type StructuralPattern = {
  patternId: string;
  docType: string; // DocumentType — never "T12"
  confidence: number; // 0.75–0.89
  detect: (doc: NormalizedDocument) => string[] | null;
};

// ---------------------------------------------------------------------------
// Pattern: Rent Roll (tenant table)
// ---------------------------------------------------------------------------

function detectRentRoll(doc: NormalizedDocument): string[] | null {
  const text = doc.firstTwoPagesText;
  const signals: string[] = [];

  // Look for column headers typical of rent rolls
  const columnPatterns = [
    /tenant/i,
    /(?:sq\.?\s*ft|square\s*feet|sqft)/i,
    /(?:monthly\s+)?rent/i,
    /(?:lease\s+)?(?:expir|end|term)/i,
    /unit\s*(?:#|no|num)/i,
  ];

  let columnHits = 0;
  for (const p of columnPatterns) {
    if (p.test(text)) {
      columnHits++;
      signals.push(`Column header: ${p.source}`);
    }
  }

  // Need at least 3 column header matches
  if (columnHits < 3) return null;

  // Look for repeating row patterns (multiple lines with dollar amounts)
  const lines = text.split("\n");
  let rowsWithDollar = 0;
  for (const line of lines) {
    if (/\$\s*[\d,]+/.test(line)) rowsWithDollar++;
  }

  if (rowsWithDollar >= 3) {
    signals.push(`${rowsWithDollar} rows with dollar amounts`);
    return signals;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pattern: Personal Financial Statement (PFS)
// ---------------------------------------------------------------------------

function detectPFS(doc: NormalizedDocument): string[] | null {
  const text = doc.firstTwoPagesText;
  const signals: string[] = [];

  // PFS has personal assets, personal liabilities, and net worth
  const hasAssets = /(?:personal\s+)?assets|cash\s+(?:on\s+)?hand|savings?\s+account/i.test(text);
  const hasLiabilities = /(?:personal\s+)?liabilities|(?:mortgage|loan)\s+(?:balance|payable)/i.test(text);
  const hasNetWorth = /net\s+worth/i.test(text);
  const hasPFSTitle = /personal\s+financial\s+statement/i.test(text);
  const hasSBA413 = /SBA\s+(?:Form\s+)?413/i.test(text);

  // Personal financial indicators that distinguish PFS from corporate Balance Sheet
  // E1.2: Expanded with additional personal-only signals to reduce PFS→BS misclassification
  const hasPersonalIndicators = /(?:contingent\s+liabilities|life\s+insurance|annual\s+(?:income|salary)|other\s+personal\s+property|installment\s+account|notes\s+payable\s+to\s+banks|guarantor|statement\s+of\s+personal|spouse|joint\s+(?:assets|statement)|social\s+security|(?:date\s+of\s+birth|DOB)|(?:home|primary)\s+(?:address|residence)|IRA|retirement\s+account|401\s*\(?\s*k\s*\)?|auto(?:mobile)?\s+(?:loan|value)|cash\s+surrender\s+value)/i.test(text);

  if (hasAssets) signals.push("Assets section detected");
  if (hasLiabilities) signals.push("Liabilities section detected");
  if (hasNetWorth) signals.push("Net Worth line detected");
  if (hasPFSTitle) signals.push("PFS title detected");
  if (hasSBA413) signals.push("SBA Form 413 detected");
  if (hasPersonalIndicators) signals.push("Personal financial indicators detected");

  // Rule 1: Assets + Liabilities + Net Worth
  if (hasAssets && hasLiabilities && hasNetWorth) return signals;
  // Rule 2: PFS/SBA413 title + one of assets/liabilities
  if ((hasPFSTitle || hasSBA413) && (hasAssets || hasLiabilities)) return signals;
  // Rule 3: Assets + Liabilities + personal-only indicators (not found on corporate balance sheets)
  if (hasAssets && hasLiabilities && hasPersonalIndicators) return signals;
  // Rule 4: PFS/SBA413 title + personal indicators (even without explicit asset/liability headers)
  if ((hasPFSTitle || hasSBA413) && hasPersonalIndicators) return signals;

  return null;
}

// ---------------------------------------------------------------------------
// Pattern: Multi-Year P&L
// ---------------------------------------------------------------------------

function detectMultiYearPL(doc: NormalizedDocument): string[] | null {
  const text = doc.firstTwoPagesText;
  const signals: string[] = [];

  // Look for adjacent year columns (e.g., "2022  2023  2024" or "2022 | 2023 | 2024")
  const yearRow = text.match(/\b(20[12]\d)\s+(?:\|?\s*)(20[12]\d)\b/);
  if (!yearRow) return null;
  signals.push(`Adjacent year columns: ${yearRow[1]}, ${yearRow[2]}`);

  // Look for P&L line items
  const plItems = [
    /(?:total\s+)?(?:revenue|sales|income)/i,
    /(?:cost\s+of\s+(?:goods\s+)?sold|cogs)/i,
    /gross\s+(?:profit|margin)/i,
    /(?:operating\s+)?(?:expenses?|costs?)/i,
    /net\s+(?:income|loss|profit|operating)/i,
  ];

  let plHits = 0;
  for (const p of plItems) {
    if (p.test(text)) {
      plHits++;
      signals.push(`P&L line: ${p.source}`);
    }
  }

  // Need year columns + at least 2 P&L line items
  if (plHits >= 2) return signals;

  return null;
}

// ---------------------------------------------------------------------------
// Pattern: Operating Statement (monthly/quarterly → INCOME_STATEMENT)
// ---------------------------------------------------------------------------

function detectOperatingStatement(doc: NormalizedDocument): string[] | null {
  const text = doc.firstTwoPagesText;
  const signals: string[] = [];

  // Look for monthly or quarterly column headers
  const monthNames =
    /(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i;
  const quarterNames = /(?:Q[1-4]|1st\s+qtr|2nd\s+qtr|3rd\s+qtr|4th\s+qtr)/i;

  const hasMonthCols = monthNames.test(text);
  const hasQuarterCols = quarterNames.test(text);

  if (!hasMonthCols && !hasQuarterCols) return null;

  if (hasMonthCols) signals.push("Monthly columns detected");
  if (hasQuarterCols) signals.push("Quarterly columns detected");

  // Look for income/expense categories
  const categories = [
    /(?:rental\s+)?income/i,
    /(?:operating\s+)?expenses?/i,
    /(?:net\s+operating\s+income|NOI)/i,
    /(?:vacancy|management\s+fee|maintenance|utilities|insurance|taxes)/i,
  ];

  let catHits = 0;
  for (const p of categories) {
    if (p.test(text)) {
      catHits++;
      signals.push(`Category: ${p.source}`);
    }
  }

  // Need month/quarter columns + at least 2 income/expense categories
  if (catHits >= 2) return signals;

  return null;
}

// ---------------------------------------------------------------------------
// Pattern: Bank Statement (transaction log format)
// ---------------------------------------------------------------------------

function detectBankTransactionLog(doc: NormalizedDocument): string[] | null {
  const text = doc.firstTwoPagesText;
  const signals: string[] = [];

  // Look for transaction table columns
  const colPatterns = [
    /(?:transaction\s+)?date/i,
    /description/i,
    /(?:debit|withdrawal)/i,
    /(?:credit|deposit)/i,
    /(?:running\s+)?balance/i,
  ];

  let colHits = 0;
  for (const p of colPatterns) {
    if (p.test(text)) {
      colHits++;
      signals.push(`Column: ${p.source}`);
    }
  }

  // Need at least 3 transaction-related columns
  if (colHits < 3) return null;

  // Look for date patterns in rows (MM/DD or MM/DD/YYYY)
  const dateRows = (text.match(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g) ?? []).length;
  if (dateRows >= 3) {
    signals.push(`${dateRows} date entries in transaction rows`);
    return signals;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Pattern: Debt Schedule
// ---------------------------------------------------------------------------

function detectDebtSchedule(doc: NormalizedDocument): string[] | null {
  const text = doc.firstTwoPagesText;
  const signals: string[] = [];

  // Primary: "debt schedule" or "schedule of liabilities"
  const hasTitle =
    /debt\s+schedule/i.test(text) ||
    /schedule\s+of\s+liabilities/i.test(text);
  if (!hasTitle) return null;
  signals.push("Debt schedule title detected");

  // Secondary: at least one of these column-type keywords
  const columns = [
    /lender/i,
    /creditor/i,
    /\bbalance\b/i,
    /\bpayment\b/i,
    /maturity/i,
    /interest\s+rate/i,
  ];

  let colHits = 0;
  for (const p of columns) {
    if (p.test(text)) {
      colHits++;
      signals.push(`Column keyword: ${p.source}`);
    }
  }

  if (colHits >= 1) return signals;
  return null;
}

// ---------------------------------------------------------------------------
// Pattern: AR Aging
// ---------------------------------------------------------------------------

function detectARAging(doc: NormalizedDocument): string[] | null {
  const text = doc.firstTwoPagesText;
  const signals: string[] = [];

  // Primary: "accounts receivable aging" or "A/R aging" or "receivables aging"
  const hasTitle =
    /accounts\s+receivable\s+aging/i.test(text) ||
    /A\/R\s+aging/i.test(text) ||
    /receivables\s+aging/i.test(text);
  if (!hasTitle) return null;
  signals.push("AR aging title detected");

  // Secondary: aging bucket columns (current/30/60/90/120 days)
  const buckets = [
    /\bcurrent\b/i,
    /\b30\s*(?:days?|d)\b/i,
    /\b60\s*(?:days?|d)\b/i,
    /\b90\s*(?:days?|d)\b/i,
    /\b120\s*(?:days?|d)\b/i,
  ];

  let bucketHits = 0;
  for (const p of buckets) {
    if (p.test(text)) {
      bucketHits++;
      signals.push(`Aging bucket: ${p.source}`);
    }
  }

  if (bucketHits >= 2) return signals;
  return null;
}

// ---------------------------------------------------------------------------
// Pattern: Voided Check
// ---------------------------------------------------------------------------

function detectVoidedCheck(doc: NormalizedDocument): string[] | null {
  const text = doc.firstTwoPagesText;
  const signals: string[] = [];

  // "VOID" and "check" both present in the document (voided checks are short docs)
  const hasVoid = /\bvoid(?:ed)?\b/i.test(text);
  const hasCheck = /\bcheck\b/i.test(text);

  if (!hasVoid || !hasCheck) return null;
  signals.push("VOID + check detected");

  // Routing/account number patterns (9-digit routing or account number label)
  const hasRouting = /\b\d{9}\b/.test(text);
  const hasAccountLabel = /(?:routing|account)\s*(?:#|number|no)/i.test(text);

  if (hasRouting) signals.push("Routing/account number pattern detected");
  if (hasAccountLabel) signals.push("Account label detected");

  if (hasRouting || hasAccountLabel) return signals;
  return null;
}

// ---------------------------------------------------------------------------
// Pattern Registry
// ---------------------------------------------------------------------------

const STRUCTURAL_PATTERNS: StructuralPattern[] = [
  {
    patternId: "RENT_ROLL_TENANT_TABLE",
    docType: "RENT_ROLL",
    confidence: 0.87,
    detect: detectRentRoll,
  },
  {
    patternId: "PFS_ASSET_LIABILITY_FORMAT",
    docType: "PFS",
    confidence: 0.85,
    detect: detectPFS,
  },
  {
    patternId: "MULTI_YEAR_PL",
    docType: "INCOME_STATEMENT", // NEVER T12
    confidence: 0.83,
    detect: detectMultiYearPL,
  },
  {
    patternId: "OPERATING_STATEMENT_MONTHLY",
    docType: "INCOME_STATEMENT", // NEVER T12 — core Buddy invariant
    confidence: 0.82,
    detect: detectOperatingStatement,
  },
  {
    patternId: "BANK_STMT_TRANSACTION_LOG",
    docType: "BANK_STATEMENT",
    confidence: 0.80,
    detect: detectBankTransactionLog,
  },
  // --- v2.1 additions ---
  {
    patternId: "VOIDED_CHECK_FORMAT",
    docType: "VOIDED_CHECK",
    confidence: 0.86,
    detect: detectVoidedCheck,
  },
  {
    patternId: "DEBT_SCHEDULE_FORMAT",
    docType: "DEBT_SCHEDULE",
    confidence: 0.82,
    detect: detectDebtSchedule,
  },
  {
    patternId: "AR_AGING_FORMAT",
    docType: "AR_AGING",
    confidence: 0.82,
    detect: detectARAging,
  },
];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run Tier 2 structural pattern detection.
 *
 * Cannot override Tier 1. Operating statements map to INCOME_STATEMENT, never T12.
 */
export function runTier2Structural(doc: NormalizedDocument): Tier2Result {
  for (const pattern of STRUCTURAL_PATTERNS) {
    const matchedSignals = pattern.detect(doc);
    if (matchedSignals) {
      const evidence: EvidenceItem[] = matchedSignals.map((signal) => ({
        type: "structural_match" as const,
        anchorId: pattern.patternId,
        matchedText: signal,
        confidence: pattern.confidence,
      }));

      return {
        matched: true,
        docType: pattern.docType,
        confidence: pattern.confidence,
        patternId: pattern.patternId,
        evidence,
      };
    }
  }

  return {
    matched: false,
    docType: null,
    confidence: 0,
    patternId: null,
    evidence: [],
  };
}

/**
 * Exported for testing only.
 * @internal
 */
export const _STRUCTURAL_PATTERNS_FOR_TESTING = STRUCTURAL_PATTERNS;
