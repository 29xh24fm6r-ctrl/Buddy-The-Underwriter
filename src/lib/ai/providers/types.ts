/**
 * Shared request/result shape for AI gateway provider adapters
 * (src/lib/ai/providers/{google,anthropic,openai}.ts). Kept separate from
 * gateway.ts so providers never import the gateway (one-directional
 * dependency: gateway → providers, never back).
 */

export type ProviderCallRequest = {
  model: string;
  prompt: string;
  systemInstruction?: string;
  maxOutputTokens?: number;
  timeoutMs: number;
  /** JSON Schema for structured output (OpenAI json_schema mode / Gemini responseSchema). */
  responseSchema?: Record<string, unknown>;
  /**
   * Request JSON output without constraining the shape via a schema.
   * Google: sets responseMimeType: "application/json" without responseSchema.
   * OpenAI: sets response_format: { type: "json_object" }.
   * Anthropic: no-op (no native JSON mode without tool-use).
   * Ignored when responseSchema is also set (the schema already implies JSON mode).
   */
  jsonMode?: boolean;
  /**
   * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §1 — selects Vertex/WIF auth instead
   * of the default GEMINI_API_KEY REST path. Google-only; ignored by
   * OpenAI/Anthropic.
   */
  authMode?: "api-key" | "vertex";
  /**
   * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §2 — inline binary content
   * (image/PDF), appended as additional content parts. Google-only today —
   * a provider that doesn't implement this must throw if given a non-empty
   * array, never silently drop it.
   */
  inlineData?: { mimeType: string; data: string /* base64 */ }[];
  /**
   * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §3 — enables Gemini's google_search
   * grounding tool. Google-only; ignored by OpenAI/Anthropic.
   */
  useSearchGrounding?: boolean;
  /**
   * SPEC-M1.1 — per-call temperature override. Each provider adapter keeps
   * its own existing default when this is absent (OpenAI/Anthropic: no
   * override, provider default; Google: 0.1 for non-Gemini-3 models,
   * ignored for Gemini 3.x models which reject sub-1.0 temperatures and
   * use thinkingConfig instead — same as before this field existed).
   */
  temperature?: number;
  /**
   * SPEC-M1.1 — overrides the thinking level used for Gemini 3.x models
   * (Google-only; ignored by other providers and by non-Gemini-3 models,
   * which use `temperature` instead). Default "low" when absent, same as
   * before this field existed.
   */
  thinkingLevel?: "minimal" | "low" | "medium" | "high";
  /**
   * SPEC-M1.1 — Gemini's mediaResolution generationConfig field, controlling
   * how finely inline image/PDF content is sampled (e.g. "MEDIA_RESOLUTION_
   * HIGH" for reading small print on multi-page tax-return detail
   * schedules). Google-only, Gemini-3.x-only; ignored otherwise. Absent by
   * default — no mediaResolution is set, same as before this field existed.
   */
  mediaResolution?: string;
};

export type ProviderCallResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
  /**
   * SPEC-GATEWAY-CAPABILITY-EXPANSION-1 §3 — present only when
   * useSearchGrounding was honored. Verbatim passthrough of Gemini's
   * candidate.groundingMetadata (groundingChunks/groundingSupports) — see
   * src/lib/research/buddyIntelligenceEngine.ts for the established
   * citation-threading parse of this exact shape.
   */
  groundingMetadata?: unknown;
};
