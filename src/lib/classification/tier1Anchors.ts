/**
 * Tier 1 — Deterministic Anchor Engine
 *
 * Hard matches only. Confidence 0.90–0.99.
 * If matched → classification LOCKED. Skip Tier 2 + Tier 3.
 *
 * Pure function — no server-only, no DB, no API.
 *
 * INVARIANT: No T12 anchor may exist in this file.
 * Tripwire test enforces this at CI.
 */

import type {
  NormalizedDocument,
  AnchorRule,
  Tier1Result,
  EvidenceItem,
} from "./types";
import { extractTaxYear, extractFormNumbers } from "./textUtils";

// ---------------------------------------------------------------------------
// Anchor Rules — Approved Set
// ---------------------------------------------------------------------------

/** IRS form anchors — highest confidence */
const FORM_ANCHORS: AnchorRule[] = [
  // 1040-SR must come BEFORE 1040 — /Form\s+1040/ would also match "Form 1040-SR"
  {
    anchorId: "IRS_1040SR_FORM_HEADER",
    pattern: /Form\s+1040-?SR\b/i,
    docType: "IRS_PERSONAL",
    confidence: 0.96,
    entityType: "personal",
    formNumber: "1040-SR",
  },
  {
    anchorId: "IRS_1040_FORM_HEADER",
    pattern: /Form\s+1040/i,
    docType: "IRS_PERSONAL",
    confidence: 0.97,
    entityType: "personal",
    formNumber: "1040",
  },
  {
    anchorId: "IRS_1040_TITLE",
    pattern: /U\.?S\.?\s+Individual\s+Income\s+Tax\s+Return/i,
    docType: "IRS_PERSONAL",
    confidence: 0.97,
    entityType: "personal",
    formNumber: "1040",
  },
  {
    anchorId: "IRS_1120S_FORM_HEADER",
    pattern: /Form\s+1120S\b/i,
    docType: "IRS_BUSINESS",
    confidence: 0.97,
    entityType: "business",
    formNumber: "1120S",
  },
  {
    anchorId: "IRS_1120_FORM_HEADER",
    pattern: /Form\s+1120\b/i,
    docType: "IRS_BUSINESS",
    confidence: 0.97,
    entityType: "business",
    formNumber: "1120",
  },
  {
    anchorId: "IRS_1065_FORM_HEADER",
    pattern: /Form\s+1065\b/i,
    docType: "IRS_BUSINESS",
    confidence: 0.97,
    entityType: "business",
    formNumber: "1065",
  },
  // K-1 must come AFTER Form 1065 — "Schedule K-1 (Form 1065)" should match K-1, not 1065
  {
    anchorId: "K1_SCHEDULE_HEADER",
    pattern: /Schedule\s+K-?1/i,
    docType: "K1",
    confidence: 0.96,
    entityType: "business",
    formNumber: "K-1",
  },
  {
    anchorId: "W2_FORM_HEADER",
    pattern: /Form\s+W-?2\b/i,
    docType: "W2",
    confidence: 0.96,
    entityType: "personal",
    formNumber: "W-2",
  },
  {
    anchorId: "1099_FORM_HEADER",
    pattern: /Form\s+1099/i,
    docType: "1099",
    confidence: 0.95,
    entityType: "personal",
    formNumber: "1099",
  },
  // --- v2.1 additions ---
  {
    anchorId: "IRS_4506_FORM_HEADER",
    pattern: /Form\s+4506-?[CT]\b/i,
    docType: "TAX_TRANSCRIPT_REQUEST",
    confidence: 0.95,
    entityType: null,
    formNumber: "4506-C",
  },
  {
    anchorId: "IRS_8821_FORM_HEADER",
    pattern: /Form\s+8821\b/i,
    docType: "TAX_AUTH",
    confidence: 0.95,
    entityType: null,
    formNumber: "8821",
  },
  {
    anchorId: "IRS_2848_FORM_HEADER",
    pattern: /Form\s+2848\b/i,
    docType: "TAX_AUTH",
    confidence: 0.95,
    entityType: null,
    formNumber: "2848",
  },
  {
    anchorId: "SBA_1919_FORM_HEADER",
    pattern: /SBA\s+Form\s+1919\b/i,
    docType: "SBA_APPLICATION",
    confidence: 0.95,
    entityType: null,
    formNumber: "SBA-1919",
  },
  {
    anchorId: "SBA_413_FORM_HEADER",
    pattern: /SBA\s+Form\s+413\b/i,
    docType: "PERSONAL_FINANCIAL_STATEMENT",
    confidence: 0.95,
    entityType: "personal",
    formNumber: "SBA-413",
  },
  {
    anchorId: "ACORD_INSURANCE_CERT",
    pattern: /ACORD\s+(?:25|27|28)\b/i,
    docType: "INSURANCE",
    confidence: 0.94,
    entityType: null,
    formNumber: null,
  },
  // --- v1.3 additions: Articles of Incorporation/Formation ---
  {
    anchorId: "ARTICLES_OF_INCORPORATION",
    pattern: /articles\s+of\s+(?:incorporation|organization)/i,
    docType: "ARTICLES",
    confidence: 0.94,
    entityType: "business",
    formNumber: null,
  },
  {
    anchorId: "CERTIFICATE_OF_FORMATION",
    pattern: /certificate\s+of\s+(?:formation|organization|good\s+standing)/i,
    docType: "ARTICLES",
    confidence: 0.94,
    entityType: "business",
    formNumber: null,
  },
  // --- v1.3 additions: SBA misc forms ---
  {
    anchorId: "SBA_912_FORM_HEADER",
    pattern: /SBA\s+Form\s+912\b/i,
    docType: "SBA_FORM",
    confidence: 0.95,
    entityType: null,
    formNumber: "SBA-912",
  },
  {
    anchorId: "SBA_159_FORM_HEADER",
    pattern: /SBA\s+Form\s+159\b/i,
    docType: "SBA_FORM",
    confidence: 0.95,
    entityType: null,
    formNumber: "SBA-159",
  },
  {
    anchorId: "SBA_2483_FORM_HEADER",
    pattern: /SBA\s+Form\s+2483\b/i,
    docType: "SBA_FORM",
    confidence: 0.95,
    entityType: null,
    formNumber: "SBA-2483",
  },
  {
    anchorId: "SBA_2484_FORM_HEADER",
    pattern: /SBA\s+Form\s+2484\b/i,
    docType: "SBA_FORM",
    confidence: 0.95,
    entityType: null,
    formNumber: "SBA-2484",
  },
  {
    anchorId: "SBA_3506_FORM_HEADER",
    pattern: /SBA\s+Form\s+3506\b/i,
    docType: "SBA_FORM",
    confidence: 0.95,
    entityType: null,
    formNumber: "SBA-3506",
  },
];

/** Structural anchors — require multiple signals */
const STRUCTURAL_ANCHORS: AnchorRule[] = [

  // ── PERSONAL FINANCIAL STATEMENT ────────────────────────────────────────
  // MUST come before BALANCE_SHEET_STRUCTURAL.
  // The OGB PFS form contains "Section 3 – Balance Sheet" as a section header,
  // which would trigger BALANCE_SHEET_STRUCTURAL without this guard.
  {
    anchorId: "PERSONAL_FINANCIAL_STMT_STRUCTURAL",
    pattern: /personal\s+financial\s+statement/i,
    docType: "PFS",
    confidence: 0.94,
    entityType: "personal",
    formNumber: null,
    secondaryPatterns: [
      /net\s+worth/i,
      /(?:total\s+assets|total\s+liabilities)/i,
    ],
    secondaryMinMatch: 2,
  },

  // ── CREDIT MEMO ─────────────────────────────────────────────────────────
  // MUST come before BALANCE_SHEET and INCOME_STATEMENT.
  // Credit memos contain financial analysis tables (assets, liabilities, revenue)
  // that would trigger those anchors if CREDIT_MEMO is positioned after them.
  // searchScope: "fullText" because DSCR, collateral, and recommendation language
  // typically appear on pages 3-6 of a 15-20 page credit memo, outside firstTwoPages.
  {
    anchorId: "CREDIT_MEMO_STRUCTURAL",
    pattern: /(?:loan\s+worksheet|officer\s+narrative|credit\s+memo(?:randum)?|credit\s+approval)/i,
    docType: "CREDIT_MEMO",
    confidence: 0.93,
    entityType: null,
    formNumber: null,
    searchScope: "fullText",
    secondaryPatterns: [
      /(?:debt\s+service\s+coverage|dscr)/i,
      /(?:collateral\s+description|collateral\s+offered)/i,
      /(?:recommend(?:ation)?|approve|approval)/i,
      /(?:loan\s+amount|loan\s+term|interest\s+rate)/i,
    ],
    secondaryMinMatch: 2,
  },

  // ── COMMERCIAL LEASE ────────────────────────────────────────────────────
  {
    anchorId: "COMMERCIAL_LEASE_STRUCTURAL",
    pattern: /(?:lease\s+agreement|amendment\s+to\s+lease|professional\s+office\s+lease|commercial\s+lease)/i,
    docType: "COMMERCIAL_LEASE",
    confidence: 0.93,
    entityType: null,
    formNumber: null,
    secondaryPatterns: [
      /(?:landlord|lessor)/i,
      /(?:tenant|lessee)/i,
      /(?:monthly\s+rent|annual\s+rent|\$[\d,]+\s*\/?\s*(?:mo|month|per\s+month))/i,
      /(?:commencement|lease\s+term|term\s+of\s+(?:this\s+)?lease)/i,
    ],
    secondaryMinMatch: 2,
  },

  // ── BALANCE SHEET ───────────────────────────────────────────────────────
  // excludePatterns: suppressed when personal financial statement language
  // is present — prevents PFS from being locked as BALANCE_SHEET.
  // (Belt-and-suspenders: PERSONAL_FINANCIAL_STMT_STRUCTURAL fires first,
  // but this exclusion catches edge cases where OCR garbles the PFS header.)
  {
    anchorId: "BALANCE_SHEET_STRUCTURAL",
    pattern: /balance\s+sheet|statement\s+of\s+financial\s+position/i,
    docType: "BALANCE_SHEET",
    confidence: 0.93,
    entityType: null,
    formNumber: null,
    excludePatterns: [
      /personal\s+financial\s+statement/i,
      /statement\s+of\s+personal/i,
      /net\s+worth.*personal/i,
    ],
    secondaryPatterns: [/total\s+assets/i, /total\s+liabilities/i],
  },

  // ── INCOME STATEMENT ────────────────────────────────────────────────────
  {
    anchorId: "INCOME_STMT_STRUCTURAL",
    pattern: /income\s+statement|profit\s+and\s+loss|profit\s*&\s*loss|statement\s+of\s+operations|operating\s+results|income\s+summary/i,
    docType: "INCOME_STATEMENT",
    confidence: 0.92,
    entityType: null,
    formNumber: null,
    secondaryPatterns: [
      /(?:total\s+)?(?:revenue|sales|income)/i,
      /(?:total\s+)?(?:expenses?|operating\s+expenses?)/i,
      /net\s+(?:income|loss|profit)/i,
    ],
    secondaryMinMatch: 2,
  },

  // ── BANK STATEMENT ──────────────────────────────────────────────────────
  {
    anchorId: "BANK_STMT_STRUCTURAL",
    pattern: /(?:beginning|opening)\s+balance/i,
    docType: "BANK_STATEMENT",
    confidence: 0.91,
    entityType: null,
    formNumber: null,
    secondaryPatterns: [/(?:ending|closing)\s+balance/i],
  },
];

// K-1 priority: must be checked before 1065 to avoid misclassifying
// "Schedule K-1 (Form 1065)" as a 1065 return
const PRIORITY_SORTED_ANCHORS: AnchorRule[] = [
  // K-1 first
  ...FORM_ANCHORS.filter((a) => a.anchorId === "K1_SCHEDULE_HEADER"),
  // Then all other form anchors
  ...FORM_ANCHORS.filter((a) => a.anchorId !== "K1_SCHEDULE_HEADER"),
  // Then structural anchors (lower confidence)
  ...STRUCTURAL_ANCHORS,
];

// ---------------------------------------------------------------------------
// Match engine
// ---------------------------------------------------------------------------

function matchAnchor(
  rule: AnchorRule,
  doc: NormalizedDocument,
): EvidenceItem | null {
  // Resolve search text based on scope
  const searchText = rule.searchScope === "fullText"
    ? doc.fullText
    : rule.formNumber
      ? doc.fullText          // form number anchors always search fullText
      : doc.firstTwoPagesText; // structural anchors default to firstTwoPages

  const match = searchText.match(rule.pattern);
  if (!match) return null;

  // Check exclusion patterns — if any match, suppress this anchor
  if (rule.excludePatterns && rule.excludePatterns.length > 0) {
    for (const ep of rule.excludePatterns) {
      if (ep.test(searchText)) return null;
    }
  }

  // Check secondary patterns if present
  if (rule.secondaryPatterns && rule.secondaryPatterns.length > 0) {
    const minMatch = rule.secondaryMinMatch ?? rule.secondaryPatterns.length;
    let secondaryHits = 0;
    for (const sp of rule.secondaryPatterns) {
      if (sp.test(searchText)) secondaryHits++;
    }
    if (secondaryHits < minMatch) return null;
  }

  return {
    type: rule.formNumber ? "form_match" : "structural_match",
    anchorId: rule.anchorId,
    matchedText: match[0],
    confidence: rule.confidence,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Run Tier 1 deterministic anchors against a normalized document.
 *
 * If matched → classification is LOCKED. Tier 2 and Tier 3 cannot override.
 */
export function runTier1Anchors(doc: NormalizedDocument): Tier1Result {
  for (const rule of PRIORITY_SORTED_ANCHORS) {
    const evidence = matchAnchor(rule, doc);  // pass doc, not text

    if (evidence) {
      const formNumbers = extractFormNumbers(doc.fullText);
      const taxYear =
        rule.entityType === "personal" || rule.entityType === "business"
          ? extractTaxYear(doc.fullText)
          : null;

      return {
        matched: true,
        docType: rule.docType,
        confidence: rule.confidence,
        anchorId: rule.anchorId,
        evidence: [evidence],
        formNumbers: formNumbers.length > 0 ? formNumbers : null,
        taxYear,
        entityType: rule.entityType,
      };
    }
  }

  // No anchor matched
  return {
    matched: false,
    docType: null,
    confidence: 0,
    anchorId: null,
    evidence: [],
    formNumbers: null,
    taxYear: null,
    entityType: null,
  };
}

/**
 * Exported for testing only — the anchor rules array.
 * @internal
 */
export const _ANCHOR_RULES_FOR_TESTING = PRIORITY_SORTED_ANCHORS;
