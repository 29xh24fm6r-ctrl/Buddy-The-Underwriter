/**
 * Standardized extraction failure codes (A2).
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 *
 * Every extraction failure MUST map to one of these.
 * No freeform failure strings allowed in deal_extraction_runs.failure_code.
 */

export const EXTRACTION_FAILURE_CODES = {
  // OCR layer
  OCR_FAILED: "OCR_FAILED",
  OCR_EMPTY_TEXT: "OCR_EMPTY_TEXT",

  // Classification layer
  CLASSIFICATION_UNKNOWN: "CLASSIFICATION_UNKNOWN",
  SEGMENTATION_REQUIRED: "SEGMENTATION_REQUIRED",

  // Structured assist layer
  STRUCTURED_TIMEOUT: "STRUCTURED_TIMEOUT",
  STRUCTURED_INVALID_JSON: "STRUCTURED_INVALID_JSON",
  STRUCTURED_SCHEMA_MISMATCH: "STRUCTURED_SCHEMA_MISMATCH",

  // Validation layer
  VALIDATION_FAILED: "VALIDATION_FAILED",

  // Slot/entity layer
  SLOT_BIND_CONFLICT: "SLOT_BIND_CONFLICT",
  ENTITY_CONFLICT: "ENTITY_CONFLICT",

  // Persistence layer
  PERSIST_FAILED: "PERSIST_FAILED",

  // Catch-all
  UNKNOWN_FATAL: "UNKNOWN_FATAL",
} as const;

export type ExtractionFailureCode =
  (typeof EXTRACTION_FAILURE_CODES)[keyof typeof EXTRACTION_FAILURE_CODES];

/**
 * All valid failure codes as a set — used for runtime validation.
 */
export const VALID_FAILURE_CODES = new Set<string>(
  Object.values(EXTRACTION_FAILURE_CODES),
);

/**
 * Validate that a failure code is one of the standardized codes.
 * Returns the typed code or "UNKNOWN_FATAL" if invalid.
 */
export function normalizeFailureCode(code: string | null | undefined): ExtractionFailureCode | null {
  if (!code) return null;
  if (VALID_FAILURE_CODES.has(code)) return code as ExtractionFailureCode;
  return EXTRACTION_FAILURE_CODES.UNKNOWN_FATAL;
}
