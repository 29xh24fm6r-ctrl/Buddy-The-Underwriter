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
};

export type ProviderCallResult = {
  text: string;
  tokensIn: number;
  tokensOut: number;
};
