/**
 * Phase E2 — Institutional Intake Quality Gate
 *
 * Pure function — no DB, no server-only. Safe for CI guard imports.
 *
 * Evaluates whether a document meets minimum extractability and
 * classification confidence thresholds for intake confirmation.
 *
 * NULL quality_status = not evaluated = fail-closed at confirmation gate.
 */

// ── Constants (CI-locked) ────────────────────────────────────────────

export const QUALITY_VERSION = "quality_v1" as const;

export const QUALITY_THRESHOLDS = {
  MIN_TEXT_LENGTH: 500,
  MIN_CLASSIFICATION_CONFIDENCE: 0.65,
} as const;

// ── Types ────────────────────────────────────────────────────────────

export type QualityStatus =
  | "PASSED"
  | "FAILED_LOW_TEXT"
  | "FAILED_LOW_CONFIDENCE"
  | "FAILED_OCR_ERROR";

export type QualityResult = {
  status: QualityStatus;
  reasons: string[];
};

// ── Pure Evaluation ──────────────────────────────────────────────────

/**
 * Evaluate document quality. Rules applied in strict order — first failure wins.
 *
 * 1. OCR must have succeeded
 * 2. Text must meet minimum length
 * 3. Classification confidence must meet minimum threshold
 * 4. Else → PASSED
 */
export function evaluateDocumentQuality(input: {
  ocrTextLength: number | null;
  ocrSucceeded: boolean;
  classificationConfidence: number | null;
}): QualityResult {
  // Rule 1: OCR must succeed
  if (!input.ocrSucceeded) {
    return {
      status: "FAILED_OCR_ERROR",
      reasons: ["OCR did not succeed"],
    };
  }

  // Rule 2: Text must meet minimum length
  if (
    input.ocrTextLength == null ||
    input.ocrTextLength < QUALITY_THRESHOLDS.MIN_TEXT_LENGTH
  ) {
    return {
      status: "FAILED_LOW_TEXT",
      reasons: [
        `Text length ${input.ocrTextLength ?? 0} below minimum ${QUALITY_THRESHOLDS.MIN_TEXT_LENGTH}`,
      ],
    };
  }

  // Rule 3: Classification confidence must meet threshold
  if (input.classificationConfidence == null) {
    return {
      status: "FAILED_LOW_CONFIDENCE",
      reasons: ["Classification confidence is null"],
    };
  }

  if (
    input.classificationConfidence <
    QUALITY_THRESHOLDS.MIN_CLASSIFICATION_CONFIDENCE
  ) {
    return {
      status: "FAILED_LOW_CONFIDENCE",
      reasons: [
        `Classification confidence ${input.classificationConfidence} below minimum ${QUALITY_THRESHOLDS.MIN_CLASSIFICATION_CONFIDENCE}`,
      ],
    };
  }

  // All checks passed
  return {
    status: "PASSED",
    reasons: [],
  };
}
