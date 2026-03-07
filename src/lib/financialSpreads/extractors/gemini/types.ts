/**
 * Gemini-Primary Extraction Types
 *
 * Pure types — no server imports, no DB. Safe for import anywhere.
 */

import type { ExtractedLineItem } from "../shared";

// ---------------------------------------------------------------------------
// Prompt types
// ---------------------------------------------------------------------------

export type GeminiExtractionPrompt = {
  systemInstruction: string;
  userPrompt: string;
  promptVersion: string;
  docType: string;
  expectedKeys: string[];
};

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export type GeminiRawResponse = {
  facts: Record<string, number | null>;
  metadata: {
    tax_year?: number | null;
    entity_name?: string | null;
    form_type?: string | null;
    period_start?: string | null;
    period_end?: string | null;
    ein?: string | null;
    taxpayer_name?: string | null;
    filing_status?: string | null;
    schedule_c_present?: boolean | null;
    schedule_e_present?: boolean | null;
    schedule_f_present?: boolean | null;
    k1_present?: boolean | null;
  };
};

export type GeminiExtractionResult = {
  ok: boolean;
  items: ExtractedLineItem[];
  rawResponse: GeminiRawResponse | null;
  latencyMs: number;
  model: string;
  promptVersion: string;
  failureReason?: string;
};

// ---------------------------------------------------------------------------
// Cross-check types
// ---------------------------------------------------------------------------

export type CrossCheckDriftItem = {
  key: string;
  geminiValue: number | null;
  deterministicValue: number | null;
  variancePct: number | null;
};

export type CrossCheckResult = {
  driftDetected: boolean;
  driftItems: CrossCheckDriftItem[];
  totalCompared: number;
  matchCount: number;
};
