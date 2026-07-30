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
