/**
 * Rules-based document classifier (Tier B).
 *
 * Pure function — no API calls, no server-only, no side effects.
 * Uses text anchors (IRS form numbers, keywords) and filename patterns
 * to classify documents deterministically.
 *
 * Confidence tiers:
 *  - Form anchors: ≥ 0.90 (e.g. "Form 1040" in text)
 *  - Keyword anchors: ≥ 0.70 (e.g. "rent roll" in text)
 *  - Filename anchors: ≥ 0.60 (e.g. "1040" in filename)
 */

import type { DocumentType } from "./classifyDocument";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RulesClassificationResult = {
  docType: DocumentType;
  confidence: number;
  reason: string;
  formNumbers: string[] | null;
  taxYear: number | null;
  entityType: "business" | "personal" | null;
  tier: "rules_form" | "rules_keyword" | "rules_filename";
};

// ---------------------------------------------------------------------------
// Form anchor rules (highest confidence)
// ---------------------------------------------------------------------------

type FormRule = {
  pattern: RegExp;
  docType: DocumentType;
  entityType: "business" | "personal" | null;
  formNumber: string;
};

const FORM_RULES: FormRule[] = [
  { pattern: /Form\s+1040/i, docType: "IRS_PERSONAL", entityType: "personal", formNumber: "1040" },
  { pattern: /Form\s+1120S\b/i, docType: "IRS_BUSINESS", entityType: "business", formNumber: "1120S" },
  { pattern: /Form\s+1120\b/i, docType: "IRS_BUSINESS", entityType: "business", formNumber: "1120" },
  // K-1 must come BEFORE Form 1065 — "Schedule K-1 (Form 1065)" matches both
  { pattern: /Schedule\s+K-?1/i, docType: "K1", entityType: "business", formNumber: "K-1" },
  { pattern: /Form\s+1065\b/i, docType: "IRS_BUSINESS", entityType: "business", formNumber: "1065" },
  { pattern: /Form\s+W-?2\b/i, docType: "W2", entityType: "personal", formNumber: "W-2" },
  { pattern: /Form\s+1099/i, docType: "1099", entityType: "personal", formNumber: "1099" },
];

// ---------------------------------------------------------------------------
// Keyword anchor rules (medium confidence)
// ---------------------------------------------------------------------------

type KeywordRule = {
  pattern: RegExp;
  docType: DocumentType;
  entityType: "business" | "personal" | null;
  /** If set, only search within first N chars of text */
  headChars?: number;
};

const KEYWORD_RULES: KeywordRule[] = [
  { pattern: /rent\s+roll/i, docType: "RENT_ROLL", entityType: null },
  { pattern: /trailing\s+12|operating\s+statement|income\s*(and|&|\/)?\s*expense/i, docType: "T12", entityType: null },
  { pattern: /personal\s+financial\s+statement/i, docType: "PFS", entityType: "personal" },
  { pattern: /articles\s+of\s+(incorporation|organization)/i, docType: "ARTICLES", entityType: "business" },
  { pattern: /certificate\s+of\s+insurance|insurance\s+certificate/i, docType: "INSURANCE", entityType: null },
  { pattern: /phase\s+(i|1)\s+environmental/i, docType: "ENVIRONMENTAL", entityType: null },
  { pattern: /appraisal\s+report/i, docType: "APPRAISAL", entityType: null, headChars: 3000 },
  { pattern: /bank\s+statement/i, docType: "BANK_STATEMENT", entityType: null },
  { pattern: /operating\s+agreement/i, docType: "OPERATING_AGREEMENT", entityType: "business" },
  { pattern: /schedule\s+of\s+real\s+estate/i, docType: "SCHEDULE_OF_RE", entityType: null },
  { pattern: /driver'?s?\s+licen[sc]e/i, docType: "DRIVERS_LICENSE", entityType: "personal" },
  { pattern: /business\s+licen[sc]e/i, docType: "BUSINESS_LICENSE", entityType: "business" },
];

// ---------------------------------------------------------------------------
// Filename anchor rules (lowest confidence)
// ---------------------------------------------------------------------------

type FilenameRule = {
  pattern: RegExp;
  docType: DocumentType;
  entityType: "business" | "personal" | null;
};

const FILENAME_RULES: FilenameRule[] = [
  { pattern: /1040/i, docType: "IRS_PERSONAL", entityType: "personal" },
  { pattern: /1120|1065/i, docType: "IRS_BUSINESS", entityType: "business" },
  { pattern: /rent.?roll/i, docType: "RENT_ROLL", entityType: null },
  { pattern: /t12|operating.?statement/i, docType: "T12", entityType: null },
  { pattern: /pfs|personal.?financial/i, docType: "PFS", entityType: "personal" },
  { pattern: /k-?1/i, docType: "K1", entityType: "business" },
  { pattern: /w-?2/i, docType: "W2", entityType: "personal" },
  { pattern: /1099/i, docType: "1099", entityType: "personal" },
  { pattern: /appraisal/i, docType: "APPRAISAL", entityType: null },
  { pattern: /insurance|coi/i, docType: "INSURANCE", entityType: null },
  { pattern: /bank.?statement/i, docType: "BANK_STATEMENT", entityType: null },
];

// ---------------------------------------------------------------------------
// Tax year extraction
// ---------------------------------------------------------------------------

function extractTaxYear(text: string): number | null {
  const head = text.slice(0, 2000);

  // Explicit: "Tax Year 2023", "For the Year Ended 2023", "For tax year 2023"
  const explicit = head.match(/(?:tax\s+year|for\s+(?:the\s+)?year(?:\s+ended)?)\s*:?\s*(20[12]\d)/i);
  if (explicit) return Number(explicit[1]);

  // Calendar year: "December 31, 2023", "12/31/2023"
  const calYear = head.match(/(?:december\s+31|12\/31)[,\s]+(\d{4})/i);
  if (calYear) return Number(calYear[1]);

  // Fallback: find 4-digit years in reasonable range in first 500 chars
  const shortHead = head.slice(0, 500);
  const years = [...shortHead.matchAll(/\b(20[12]\d)\b/g)].map((m) => Number(m[1]));
  if (years.length > 0) {
    // Return the most recent year found
    return Math.max(...years);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Collect form numbers from text
// ---------------------------------------------------------------------------

function extractFormNumbers(text: string): string[] {
  const head = text.slice(0, 3000);
  const forms = new Set<string>();

  const patterns: Array<[RegExp, string]> = [
    [/Form\s+1040/i, "1040"],
    [/Form\s+1120S\b/i, "1120S"],
    [/Form\s+1120\b/i, "1120"],
    [/Form\s+1065/i, "1065"],
    [/Schedule\s+K-?1/i, "K-1"],
    [/Schedule\s+C\b/i, "Schedule C"],
    [/Schedule\s+E\b/i, "Schedule E"],
    [/Form\s+W-?2/i, "W-2"],
    [/Form\s+1099/i, "1099"],
  ];

  for (const [pattern, name] of patterns) {
    if (pattern.test(head)) forms.add(name);
  }

  return forms.size > 0 ? [...forms] : [];
}

// ---------------------------------------------------------------------------
// Main classifier
// ---------------------------------------------------------------------------

/**
 * Attempt to classify a document using deterministic rules.
 * Returns null if no rules match with sufficient confidence.
 */
export function classifyByRules(
  text: string,
  filename: string,
): RulesClassificationResult | null {
  // ── Tier 1: Form anchors (confidence 0.92) ────────────────────────────
  for (const rule of FORM_RULES) {
    if (rule.pattern.test(text)) {
      const formNumbers = extractFormNumbers(text);
      const taxYear = rule.docType === "IRS_PERSONAL" || rule.docType === "IRS_BUSINESS" || rule.docType === "K1"
        ? extractTaxYear(text)
        : null;

      return {
        docType: rule.docType,
        confidence: 0.92,
        reason: `Form anchor: "${rule.formNumber}" found in document text`,
        formNumbers: formNumbers.length > 0 ? formNumbers : [rule.formNumber],
        taxYear,
        entityType: rule.entityType,
        tier: "rules_form",
      };
    }
  }

  // ── Tier 2: Keyword anchors (confidence 0.72) ─────────────────────────
  for (const rule of KEYWORD_RULES) {
    const searchText = rule.headChars ? text.slice(0, rule.headChars) : text;
    if (rule.pattern.test(searchText)) {
      return {
        docType: rule.docType,
        confidence: 0.72,
        reason: `Keyword anchor: "${rule.pattern.source}" matched in document text`,
        formNumbers: null,
        taxYear: null,
        entityType: rule.entityType,
        tier: "rules_keyword",
      };
    }
  }

  // ── Tier 3: Filename anchors (confidence 0.62) ────────────────────────
  if (filename) {
    for (const rule of FILENAME_RULES) {
      if (rule.pattern.test(filename)) {
        return {
          docType: rule.docType,
          confidence: 0.62,
          reason: `Filename anchor: "${rule.pattern.source}" matched in filename "${filename}"`,
          formNumbers: null,
          taxYear: null,
          entityType: rule.entityType,
          tier: "rules_filename",
        };
      }
    }
  }

  return null;
}
