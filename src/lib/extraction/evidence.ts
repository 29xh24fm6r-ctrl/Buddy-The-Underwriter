/**
 * Extraction Evidence Types (D2).
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 *
 * Every extracted numeric fact should include evidence about:
 * - source: where the value came from (structured JSON vs OCR regex)
 * - matched text snippet (hashed for privacy)
 * - deterministic confidence score (NOT LLM confidence)
 */

import { createHash } from "crypto";

// ── Types ─────────────────────────────────────────────────────────────

export type ExtractionSource = "structured" | "ocr_regex" | "derived";

export type FactEvidence = {
  /** Where this fact value came from */
  source: ExtractionSource;
  /** SHA-256 of the matched text snippet (privacy-safe) */
  matched_text_hash: string | null;
  /** Confidence from deterministic anchoring (NOT LLM confidence) */
  deterministic_confidence: number;
  /** Anchor IDs that were matched (e.g. "entity:gross_receipts", "regex:revenue_line") */
  anchor_ids: string[];
  /** Page numbers where the value was found (if available) */
  page_numbers?: number[];
};

// ── Confidence Rules ─────────────────────────────────────────────────

/**
 * Compute deterministic confidence for a fact based on evidence quality.
 *
 * Rules:
 * - High (0.90+): Structured JSON entity + OCR regex agree
 * - Medium (0.70-0.89): Either structured or regex alone, clear anchor
 * - Low (0.50-0.69): Weak match, ambiguous anchors
 * - Unreviewed (0.0): No evidence at all
 */
export function computeDeterministicConfidence(args: {
  fromStructured: boolean;
  fromOcrRegex: boolean;
  anchorCount: number;
  valuesAgree?: boolean;
}): number {
  // Both sources agree → high confidence
  if (args.fromStructured && args.fromOcrRegex && args.valuesAgree !== false) {
    return 0.95;
  }

  // Both sources but disagreement → medium (human must review)
  if (args.fromStructured && args.fromOcrRegex && args.valuesAgree === false) {
    return 0.60;
  }

  // Single source with strong anchoring
  if (args.fromStructured && args.anchorCount >= 1) {
    return 0.85;
  }

  if (args.fromOcrRegex && args.anchorCount >= 2) {
    return 0.80;
  }

  if (args.fromOcrRegex && args.anchorCount === 1) {
    return 0.70;
  }

  // Derived (computed from other facts)
  return 0.50;
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Hash a text snippet for privacy-safe evidence storage.
 */
export function hashSnippet(text: string | null | undefined): string | null {
  if (!text || text.trim().length === 0) return null;
  return createHash("sha256").update(text.trim()).digest("hex").slice(0, 16);
}

/**
 * Build a FactEvidence record from extraction context.
 */
export function buildFactEvidence(args: {
  source: ExtractionSource;
  matchedText?: string | null;
  anchorIds: string[];
  deterministicConfidence: number;
  pageNumbers?: number[];
}): FactEvidence {
  return {
    source: args.source,
    matched_text_hash: hashSnippet(args.matchedText),
    deterministic_confidence: args.deterministicConfidence,
    anchor_ids: args.anchorIds,
    page_numbers: args.pageNumbers,
  };
}
