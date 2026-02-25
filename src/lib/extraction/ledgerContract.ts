/**
 * Extraction Ledger Event Contract (A3).
 *
 * Pure module — no server-only, no DB, safe for CI guard imports.
 *
 * Defines the canonical event kinds for extraction pipeline events
 * written to the deal_events table (canonical ledger).
 *
 * Every extraction ledger payload MUST include the fields specified
 * in ExtractionLedgerPayload.
 */

// ── Event Kinds ──────────────────────────────────────────────────────

export const EXTRACTION_EVENT_KINDS = {
  RUN_STARTED: "extraction.run.started",
  OCR_COMPLETED: "extraction.ocr.completed",
  STRUCTURED_ATTEMPTED: "extraction.structured.attempted",
  STRUCTURED_COMPLETED: "extraction.structured.completed",
  STRUCTURED_FAILED: "extraction.structured.failed",
  VALIDATION_PASSED: "extraction.validation.passed",
  VALIDATION_FAILED: "extraction.validation.failed",
  SLOT_BOUND: "extraction.slot_bound",
  ROUTED_TO_REVIEW: "extraction.routed_to_review",
  RUN_COMPLETED: "extraction.run.completed",
} as const;

export type ExtractionEventKind =
  (typeof EXTRACTION_EVENT_KINDS)[keyof typeof EXTRACTION_EVENT_KINDS];

/**
 * All valid extraction event kinds as a set — used for runtime validation.
 */
export const VALID_EXTRACTION_EVENT_KINDS = new Set<string>(
  Object.values(EXTRACTION_EVENT_KINDS),
);

// ── Payload Contract ─────────────────────────────────────────────────

/**
 * Required fields in every extraction ledger event payload.
 * These are written to deal_events.payload.meta.
 */
export type ExtractionLedgerPayload = {
  /** UUID of the deal_extraction_runs row */
  run_id: string;
  /** UUID of the document being extracted */
  document_id: string;
  /** Engine version (e.g. "hybrid_v1.0") */
  engine_version: string;
  /** SHA-256 of normalized input */
  input_hash: string;
  /** Failure code if any (from failureCodes.ts) */
  failure_code?: string | null;
  /** Confidence signals from extraction */
  confidence_signals?: Record<string, number> | null;
  /** Performance + cost metrics */
  metrics?: {
    latency_ms?: number;
    cost_estimate_usd?: number;
    pages?: number;
    tokens_in?: number;
    tokens_out?: number;
  } | null;
};

// ── Engine Version ──────────────────────────────────────────────────

/**
 * Current engine version. Increment on any extraction pipeline change.
 */
export const EXTRACTION_ENGINE_VERSION = "hybrid_v1.0";
