/**
 * LLM Router — maps task lanes to resolved model configuration.
 *
 * Call sites ask for a lane, never a raw model string. The router
 * resolves the lane to a ResolvedModel carrying the provider path
 * and thinking-mode flag. This keeps the choice of Google Generative
 * Language REST vs Vertex SDK vs OpenAI abstracted from application code.
 */

import {
  GEMINI_FLASH,
  GEMINI_PRO,
  OPENAI_CHAT,
  OPENAI_MINI,
  OPENAI_EMBEDDINGS,
  OPENAI_REALTIME,
} from "./models";

export type ModelLane =
  | "fast"        // Gemini Flash — default for all new Gemini work
  | "deep"        // Gemini Pro — thinking mode, narratives
  | "research"    // Gemini Flash + Google Search grounding
  | "extraction"  // Gemini Flash via VertexAI SDK
  | "classifier"  // Gemini Flash via VertexAI SDK
  | "committee"   // OpenAI GPT-4o (legacy)
  | "retrieval"   // OpenAI mini (legacy)
  | "embed"       // OpenAI embeddings (legacy)
  | "realtime";   // OpenAI Realtime (voice)

export type ProviderPath = "gemini-rest" | "gemini-vertex" | "openai";

export type ResolvedModel = {
  model: string;
  provider: ProviderPath;
  thinkingEnabled: boolean;
};

export function resolveModel(lane: ModelLane): ResolvedModel {
  switch (lane) {
    case "deep":
      return { model: GEMINI_PRO, provider: "gemini-rest", thinkingEnabled: true };
    case "research":
      return { model: GEMINI_FLASH, provider: "gemini-rest", thinkingEnabled: false };
    case "extraction":
      return { model: GEMINI_FLASH, provider: "gemini-vertex", thinkingEnabled: false };
    case "classifier":
      return { model: GEMINI_FLASH, provider: "gemini-vertex", thinkingEnabled: false };
    case "committee":
      return { model: OPENAI_CHAT, provider: "openai", thinkingEnabled: false };
    case "retrieval":
      return { model: OPENAI_MINI, provider: "openai", thinkingEnabled: false };
    case "embed":
      return { model: OPENAI_EMBEDDINGS, provider: "openai", thinkingEnabled: false };
    case "realtime":
      return { model: OPENAI_REALTIME, provider: "openai", thinkingEnabled: false };
    case "fast":
    default:
      return { model: GEMINI_FLASH, provider: "gemini-rest", thinkingEnabled: false };
  }
}
