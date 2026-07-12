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
  /**
   * Whether matchedText was confirmed to actually occur in the source
   * document text. `null` means the caller did not supply sourceText to
   * verify against — treat as UNVERIFIED, not as confirmed. `false` means
   * verification was attempted and failed (matchedText is not anchored in
   * the source — do not trust it as strong evidence).
   */
  text_verified: boolean | null;
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
 * Normalize text for anchoring comparisons — collapses whitespace/case so
 * OCR line-wraps and spacing differences don't cause false negatives.
 */
function normalizeForMatch(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Verify that matchedText actually occurs in sourceText.
 *
 * Returns:
 *   - `null` if sourceText was not supplied (nothing to verify against —
 *     callers that haven't plumbed source text through yet get an honest
 *     "unverified" rather than a false "verified").
 *   - `false` if sourceText was supplied but matchedText is missing/empty,
 *     or is not actually present in it.
 *   - `true` if matchedText is present in sourceText (whitespace/case
 *     normalized).
 */
export function verifyMatchedTextInSource(
  matchedText: string | null | undefined,
  sourceText: string | null | undefined,
): boolean | null {
  if (!sourceText || !sourceText.trim()) return null;
  if (!matchedText || !matchedText.trim()) return false;
  return normalizeForMatch(sourceText).includes(normalizeForMatch(matchedText));
}

/**
 * Build a FactEvidence record from extraction context.
 *
 * When `sourceText` is supplied, matchedText is verified against it before
 * being trusted — a caller-supplied matchedText that doesn't actually
 * appear in the source document is not real evidence, so its deterministic
 * confidence is capped rather than persisted as-claimed.
 */
export function buildFactEvidence(args: {
  source: ExtractionSource;
  matchedText?: string | null;
  /** Full source document text to verify matchedText against (D2 fix). */
  sourceText?: string | null;
  anchorIds: string[];
  deterministicConfidence: number;
  pageNumbers?: number[];
}): FactEvidence {
  const textVerified = verifyMatchedTextInSource(args.matchedText, args.sourceText);

  const deterministicConfidence =
    textVerified === false
      ? Math.min(args.deterministicConfidence, 0.5)
      : args.deterministicConfidence;

  return {
    source: args.source,
    matched_text_hash: hashSnippet(args.matchedText),
    deterministic_confidence: deterministicConfidence,
    anchor_ids: args.anchorIds,
    page_numbers: args.pageNumbers,
    text_verified: textVerified,
  };
}
