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
];

/** Structural anchors — require multiple signals */
const STRUCTURAL_ANCHORS: AnchorRule[] = [
  {
    anchorId: "BALANCE_SHEET_STRUCTURAL",
    pattern: /balance\s+sheet|statement\s+of\s+financial\s+position/i,
    docType: "BALANCE_SHEET",
    confidence: 0.93,
    entityType: null,
    formNumber: null,
    secondaryPatterns: [/total\s+assets/i, /total\s+liabilities/i],
    // Both secondary patterns required
  },
  {
    anchorId: "INCOME_STMT_STRUCTURAL",
    pattern: /income\s+statement|profit\s+and\s+loss|profit\s*&\s*loss|statement\s+of\s+operations/i,
    docType: "INCOME_STATEMENT",
    confidence: 0.92,
    entityType: null,
    formNumber: null,
    secondaryPatterns: [
      /(?:total\s+)?(?:revenue|sales|income)/i,
      /(?:total\s+)?(?:expenses?|operating\s+expenses?)/i,
      /net\s+(?:income|loss|profit)/i,
    ],
    secondaryMinMatch: 2, // At least 2 of 3
  },
  {
    anchorId: "BANK_STMT_STRUCTURAL",
    pattern: /(?:beginning|opening)\s+balance/i,
    docType: "BANK_STATEMENT",
    confidence: 0.91,
    entityType: null,
    formNumber: null,
    secondaryPatterns: [/(?:ending|closing)\s+balance/i],
    // Ending balance required
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
  text: string,
): EvidenceItem | null {
  const match = text.match(rule.pattern);
  if (!match) return null;

  // Check secondary patterns if present
  if (rule.secondaryPatterns && rule.secondaryPatterns.length > 0) {
    const minMatch = rule.secondaryMinMatch ?? rule.secondaryPatterns.length;
    let secondaryHits = 0;
    for (const sp of rule.secondaryPatterns) {
      if (sp.test(text)) secondaryHits++;
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
  // Search full text for form anchors (form numbers can appear anywhere)
  // Use firstTwoPagesText for structural anchors (header signals are early)
  for (const rule of PRIORITY_SORTED_ANCHORS) {
    const searchText = rule.formNumber ? doc.fullText : doc.firstTwoPagesText;
    const evidence = matchAnchor(rule, searchText);

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
