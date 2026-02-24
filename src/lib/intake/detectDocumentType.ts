/**
 * Deterministic Document Type Detection — Pure Function
 *
 * Cross-check layer, segmentation detector, and sanity validator.
 * NOT a replacement classifier — Spine v2 remains the sole classification authority.
 *
 * This function uses regex anchors and keyword patterns to detect document type
 * from OCR text. It never touches the DB, never emits events, never changes
 * classification.
 *
 * Used by the orchestrator for:
 * - Pre-classification sanity check
 * - Segmentation detection (mixed form types in one PDF)
 * - Confidence validation against Spine v2 output
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DetectedDocumentType = {
  canonical_type:
    | "BUSINESS_TAX_RETURN"
    | "PERSONAL_TAX_RETURN"
    | "BALANCE_SHEET"
    | "INCOME_STATEMENT"
    | "UNKNOWN";
  detected_tax_year: number | null;
  anchor_evidence: string[];
  confidence_score: number;
  requires_segmentation: boolean;
};

// ---------------------------------------------------------------------------
// Anchor patterns
// ---------------------------------------------------------------------------

// Business Tax Return anchors
const BTR_FORM_RE = /Form\s+(?:1120[S]?|1065)\b/i;
const SCHEDULE_L_RE = /Schedule\s+L\b/i;
const EIN_RE = /\b\d{2}-\d{7}\b/;

// Personal Tax Return anchors
const PTR_FORM_RE = /Form\s+1040\b/i;
const AGI_RE = /Adjusted\s+Gross\s+Income/i;
const SSN_RE = /\b\d{3}-\d{2}-\d{4}\b/;

// Balance Sheet anchors
const BS_TOTAL_ASSETS_RE = /Total\s+Assets/i;
const BS_TOTAL_LIABILITIES_RE = /Total\s+Liabilities/i;
const BS_TOTAL_EQUITY_RE = /Total\s+(?:Equity|(?:Stockholders?['']?\s+)?Equity|Net\s+Worth|Partners?['']?\s+Capital|Members?['']?\s+Equity)/i;

// Income Statement anchors
const IS_REVENUE_RE = /\b(?:Revenue|Total\s+(?:Sales|Revenue)|Net\s+(?:Sales|Revenue)|Gross\s+(?:Sales|Revenue))\b/i;
const IS_COGS_RE = /Cost\s+of\s+(?:Goods\s+Sold|Sales|Revenue)|\bCOGS\b/i;
const IS_NET_INCOME_RE = /Net\s+(?:Income|Profit|Loss|Earnings)\b/i;

// Year detection
const TAX_YEAR_RE = /(?:Tax\s+Year|Taxable\s+Year|For\s+(?:the\s+)?(?:Calendar\s+)?Year)\s+(?:Ending\s+)?(?:December\s+31,\s+)?(20\d{2})/i;
const HEADER_YEAR_RE = /\b(20\d{2})\b/;

// Segmentation triggers
const W2_RE = /Form\s+W-?2\b/i;

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detect document type from OCR page text.
 *
 * Pure function — no side effects.
 */
export function detectDocumentType(
  pages: Array<{ page_number: number; full_text: string }>,
): DetectedDocumentType {
  const fullText = pages.map((p) => p.full_text).join("\n");
  // Use first ~5000 chars for anchor detection (covers header/first pages)
  const headerText = fullText.slice(0, 5000);

  const evidence: string[] = [];
  let btrScore = 0;
  let ptrScore = 0;
  let bsScore = 0;
  let isScore = 0;

  // ── Business Tax Return ──────────────────────────────────────────
  if (BTR_FORM_RE.test(headerText)) {
    evidence.push("BTR_FORM_MATCH");
    btrScore += 0.4;
  }
  if (SCHEDULE_L_RE.test(fullText)) {
    evidence.push("SCHEDULE_L_PRESENT");
    btrScore += 0.3;
  }
  if (EIN_RE.test(headerText)) {
    evidence.push("EIN_DETECTED");
    btrScore += 0.2;
  }

  // ── Personal Tax Return ──────────────────────────────────────────
  if (PTR_FORM_RE.test(headerText)) {
    evidence.push("PTR_FORM_1040_MATCH");
    ptrScore += 0.4;
  }
  if (AGI_RE.test(fullText)) {
    evidence.push("AGI_KEYWORD");
    ptrScore += 0.3;
  }
  if (SSN_RE.test(headerText)) {
    evidence.push("SSN_DETECTED");
    ptrScore += 0.2;
  }

  // ── Balance Sheet ────────────────────────────────────────────────
  if (BS_TOTAL_ASSETS_RE.test(fullText)) {
    evidence.push("BS_TOTAL_ASSETS");
    bsScore += 0.35;
  }
  if (BS_TOTAL_LIABILITIES_RE.test(fullText)) {
    evidence.push("BS_TOTAL_LIABILITIES");
    bsScore += 0.35;
  }
  if (BS_TOTAL_EQUITY_RE.test(fullText)) {
    evidence.push("BS_TOTAL_EQUITY");
    bsScore += 0.3;
  }

  // ── Income Statement ─────────────────────────────────────────────
  if (IS_REVENUE_RE.test(fullText)) {
    evidence.push("IS_REVENUE");
    isScore += 0.35;
  }
  if (IS_COGS_RE.test(fullText)) {
    evidence.push("IS_COGS");
    isScore += 0.35;
  }
  if (IS_NET_INCOME_RE.test(fullText)) {
    evidence.push("IS_NET_INCOME");
    isScore += 0.3;
  }

  // ── Segmentation detection ───────────────────────────────────────
  // Mixed form types in one PDF suggest stapled/combined documents
  const hasBtrAnchors = btrScore >= 0.4;
  const hasPtrAnchors = ptrScore >= 0.4;
  const hasW2 = W2_RE.test(fullText);
  const requires_segmentation =
    (hasBtrAnchors && hasPtrAnchors) || (hasBtrAnchors && hasW2);

  // ── Select winner ────────────────────────────────────────────────
  const scores = [
    { type: "BUSINESS_TAX_RETURN" as const, score: btrScore },
    { type: "PERSONAL_TAX_RETURN" as const, score: ptrScore },
    { type: "BALANCE_SHEET" as const, score: bsScore },
    { type: "INCOME_STATEMENT" as const, score: isScore },
  ];

  // Sort descending by score
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];

  // Minimum threshold for a positive detection
  if (best.score < 0.3) {
    return {
      canonical_type: "UNKNOWN",
      detected_tax_year: detectTaxYear(headerText),
      anchor_evidence: evidence,
      confidence_score: 0,
      requires_segmentation,
    };
  }

  return {
    canonical_type: best.type,
    detected_tax_year: detectTaxYear(headerText),
    anchor_evidence: evidence,
    confidence_score: Math.min(1, best.score),
    requires_segmentation,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectTaxYear(text: string): number | null {
  // Try explicit "Tax Year XXXX" pattern first
  const explicit = text.match(TAX_YEAR_RE);
  if (explicit?.[1]) {
    const year = parseInt(explicit[1], 10);
    if (year >= 2000 && year <= 2099) return year;
  }

  // Fall back to header year — find years in first 500 chars
  const headerSnippet = text.slice(0, 500);
  const years: number[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(HEADER_YEAR_RE.source, "g");
  while ((m = re.exec(headerSnippet)) !== null) {
    const y = parseInt(m[1], 10);
    if (y >= 2015 && y <= 2099) years.push(y);
  }

  // Return most recent year found
  if (years.length > 0) return Math.max(...years);

  return null;
}
