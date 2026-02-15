/**
 * OpenAI Gatekeeper — Type Definitions
 *
 * Granular document type classification + routing types.
 * GatekeeperDocType is more granular than existing ClassificationResult
 * (distinguishes W2, K1, 1099 instead of lumping into "PERSONAL_TAX_RETURN").
 */

// ─── Doc Type Enum ──────────────────────────────────────────────────────────

export type GatekeeperDocType =
  | "BUSINESS_TAX_RETURN"
  | "PERSONAL_TAX_RETURN"
  | "W2"
  | "FORM_1099"
  | "K1"
  | "BANK_STATEMENT"
  | "FINANCIAL_STATEMENT"
  | "DRIVERS_LICENSE"
  | "VOIDED_CHECK"
  | "OTHER"
  | "UNKNOWN";

// ─── Routing ────────────────────────────────────────────────────────────────

export type GatekeeperRoute =
  | "GOOGLE_DOC_AI_CORE"
  | "STANDARD"
  | "NEEDS_REVIEW";

// ─── Raw OpenAI Output ──────────────────────────────────────────────────────

/** Shape returned by the OpenAI structured output (no route — that's computed). */
export type GatekeeperClassification = {
  doc_type: GatekeeperDocType;
  confidence: number; // 0.0 – 1.0
  tax_year: number | null;
  reasons: string[]; // max 6
  detected_signals: {
    form_numbers: string[];
    has_ein: boolean;
    has_ssn: boolean;
  };
};

// ─── Full Result (after routing applied) ────────────────────────────────────

export type GatekeeperResult = GatekeeperClassification & {
  route: GatekeeperRoute;
  needs_review: boolean;
  cache_hit: boolean;
  model: string;
  prompt_version: string;
  prompt_hash: string;
  prompt_tokens?: number;
  completion_tokens?: number;
  latency_ms?: number;
  input_path: "text" | "vision" | "cache" | "error" | "no_ocr_no_image" | "already_classified";
};

// ─── Input ──────────────────────────────────────────────────────────────────

export type GatekeeperDocInput = {
  documentId: string;
  dealId: string;
  bankId: string;
  sha256: string | null;
  ocrText: string | null;
  storageBucket: string;
  storagePath: string;
  mimeType: string;
  forceReclassify?: boolean;
};

// ─── Batch Result ───────────────────────────────────────────────────────────

export type GatekeeperBatchResult = {
  total: number;
  classified: number;
  cached: number;
  needs_review: number;
  errors: number;
  results: Array<{
    documentId: string;
    result: GatekeeperResult | null;
    error?: string;
  }>;
};
