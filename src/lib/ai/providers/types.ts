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
   * Request provider-native JSON-object output without imposing a strict
   * schema. Use this for caller-validated payloads whose legitimate shape
   * includes dynamic keys or JSON-typed values that cannot be represented
   * by OpenAI's strict JSON Schema subset.
   */
  responseJsonObject?: boolean;
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
  /**
   * When true, a MAX_TOKENS finish with non-empty reply text is returned
   * (flagged `truncated: true`) instead of thrown, so a caller that can
   * repair a cut-off JSON document (the BIE synthesis thread) gets the
   * partial output. Every other finish reason still throws. Off by default:
   * free-text callers must never silently consume a truncated answer.
   */
  allowTruncatedOutput?: boolean;
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
  /** Set only when allowTruncatedOutput was honored on a MAX_TOKENS finish. */
  truncated?: boolean;
  finishReason?: string;
  /** Gemini 3.x usageMetadata.thoughtsTokenCount — reasoning tokens that share the output window. */
  thoughtsTokenCount?: number;
};
