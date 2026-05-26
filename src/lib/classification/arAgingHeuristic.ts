/**
 * AR Aging Heuristic — Last-Resort Safety Net
 *
 * Catches obvious AR aging reports that slipped through Tier 1-3 classification.
 * Applied ONLY when classification returned OTHER / fallback / low confidence.
 *
 * Do not use as the primary classifier — Tier 1 anchor and Tier 2 structural
 * should catch AR aging before this runs.
 *
 * Pure function — no DB, no server-only.
 */

export type ArAgingHeuristicResult = {
  matched: boolean;
  docType: "AR_AGING" | null;
  confidence: number;
  reason: string;
};

const AR_TITLE_RE = /(?:A\/R|AR|accounts\s+receivable|receivables)\s+aging/i;
const AP_GUARD_RE = /\baccounts\s+payable\s+aging\b|\bA\/P\s+aging\b|\b(?:vendor|supplier)\s+aging\b/i;

const BUCKET_PATTERNS = [
  /\bcurrent\b/i,
  /\b\d{1,2}\s*-\s*\d{2}\b/,       // 1-30, 31-60, 61-90
  /\b(?:90|91)\s*(?:and|&)?\s*over\b/i,
  /\b(?:90|91|120)\+\b/,
  /\btotal\b/i,
];

const AR_FILENAME_RE = /(?:A\/R|AR|accounts[\s_-]*receivable)[\s_-]*aging/i;

/**
 * Detect AR aging from filename and/or OCR text when the primary
 * classifier returned OTHER or low confidence.
 */
export function detectArAgingHeuristic(args: {
  filename: string | null;
  text: string;
}): ArAgingHeuristicResult {
  const { filename, text } = args;

  // Guard: AP/payables aging
  if (AP_GUARD_RE.test(text) || (filename && AP_GUARD_RE.test(filename))) {
    return { matched: false, docType: null, confidence: 0, reason: "AP/payables aging detected — not AR" };
  }

  // Count bucket hits
  let bucketHits = 0;
  for (const p of BUCKET_PATTERNS) {
    if (p.test(text)) bucketHits++;
  }

  // Path 1: filename contains AR Aging + text has bucket signals
  if (filename && AR_FILENAME_RE.test(filename) && bucketHits >= 2) {
    return {
      matched: true,
      docType: "AR_AGING",
      confidence: 0.88,
      reason: "Deterministic AR aging heuristic: filename + bucket signals",
    };
  }

  // Path 2: text contains AR aging title + bucket signals
  if (AR_TITLE_RE.test(text) && bucketHits >= 2) {
    return {
      matched: true,
      docType: "AR_AGING",
      confidence: 0.88,
      reason: "Deterministic AR aging heuristic: title + bucket signals",
    };
  }

  return { matched: false, docType: null, confidence: 0, reason: "No AR aging signals" };
}
