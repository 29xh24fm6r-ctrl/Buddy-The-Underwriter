/**
 * BUDDY AI MODEL REGISTRY
 * ══════════════════════════════════════════════════════════════
 * Single source of truth for all LLM model identifier strings.
 *
 * THREE PROVIDER STACKS exist in Buddy:
 *   GEMINI REST   — GEMINI_API_KEY + fetch to generativelanguage.googleapis.com
 *   GEMINI VERTEX — VertexAI SDK + GCP ADC (@google-cloud/vertexai)
 *   OPENAI        — OPENAI_API_KEY + OpenAI SDK (existing layer)
 *
 * TO UPDATE THE ENTIRE SYSTEM: change a value here and redeploy.
 * NEVER hardcode model strings outside this file. A CI guard at
 * scripts/ci/verify_model_strings.js enforces this on every build.
 *
 * NOTE: src/lib/modelGovernance/modelRegistry.ts is a SEPARATE concern —
 * it documents governance rules (human override, input/output scope).
 * This file owns the actual model string values.
 *
 * Verify active Gemini models:
 *   GET https://generativelanguage.googleapis.com/v1beta/models
 *       ?key=GEMINI_API_KEY&pageSize=100
 * ══════════════════════════════════════════════════════════════
 */

// ── GEMINI — Primary inference stack ──────────────────────────────────────

/**
 * Fast model — default for all high-volume Gemini tasks.
 * Replaces: gemini-2.0-flash (RETIRED), gemini-1.5-flash (RETIRED),
 *           gemini-2.5-flash, gemini-3-flash-preview (all unified here).
 * Validated working on both REST and VertexAI SDK paths.
 */
export const GEMINI_FLASH = "gemini-3-flash-preview";

/**
 * Deep reasoning model — thinking mode, complex analysis.
 * Replaces: gemini-2.5-pro-preview-03-25 (RETIRED — the dated preview
 *           alias is no longer served).
 *
 * Phase 93 NOTE: ListModels could not be called from the build
 * environment (no GEMINI_API_KEY locally). Using the stable
 * unversioned alias "gemini-2.5-pro" per the Phase 93 fallback rule.
 * A production operator should run:
 *   GET https://generativelanguage.googleapis.com/v1beta/models?key=$KEY&pageSize=100
 * and update this constant if the API returns a more specific stable
 * alias for the current Pro model.
 */
export const GEMINI_PRO = "gemini-2.5-pro";

// ── OPENAI — Legacy stack (existing, not migrating in this phase) ─────────

/**
 * OpenAI primary chat model.
 * Used by: committee, concierge, memo sections, risk explain, ask,
 *          borrower extraction, financial normalization, retrieval.
 * Hard rule: no NEW call sites should use OpenAI — use GEMINI_FLASH.
 */
export const OPENAI_CHAT = "gpt-4o-2024-08-06";

/**
 * OpenAI mini model — cheaper, lower-latency tasks.
 * Used by: orchestrator, retrieval reranker, ask route.
 */
export const OPENAI_MINI = "gpt-4o-mini";

/**
 * OpenAI embeddings — retrieval/RAG layer.
 * Used by: retrievalCore, embeddings, ask, risk explain, memo generate.
 * Do NOT replace with Gemini embeddings without testing retrieval quality.
 */
export const OPENAI_EMBEDDINGS = "text-embedding-3-small";

/**
 * OpenAI reasoning model — used by the task router for deep_reasoning lane.
 */
export const OPENAI_REASONING = "o1-preview";

/**
 * OpenAI realtime model — voice interview stack.
 */
export const OPENAI_REALTIME = "gpt-4o-realtime-preview-2024-12-17";

/**
 * OpenAI transcription model — realtime voice → text.
 */
export const OPENAI_REALTIME_TRANSCRIBE = "gpt-4o-mini-transcribe";

// ── Intent-named aliases — use these at all call sites ────────────────────

// Gemini lanes
export const MODEL_NARRATIVE      = GEMINI_PRO;    // credit memo narratives
export const MODEL_RISK           = GEMINI_FLASH;  // risk grading (Gemini path)
export const MODEL_EXTRACTION     = GEMINI_FLASH;  // document extraction (VertexAI)
export const MODEL_CLASSIFICATION = GEMINI_FLASH;  // doc classification (VertexAI)
export const MODEL_RESEARCH       = GEMINI_FLASH;  // BIE 8-thread research
export const MODEL_OCR            = GEMINI_FLASH;  // Gemini OCR job
export const MODEL_SBA_NARRATIVE  = GEMINI_FLASH;  // SBA package narrative
export const MODEL_CLASSIC_SPREAD = GEMINI_FLASH;  // classic spread narrative engine
export const MODEL_OMEGA          = GEMINI_FLASH;  // Omega relationship/portfolio
export const MODEL_RATES          = GEMINI_FLASH;  // index rates

// OpenAI lanes (existing — no migration in this phase)
export const MODEL_COMMITTEE      = OPENAI_CHAT;   // credit committee
export const MODEL_CONCIERGE      = OPENAI_CHAT;   // borrower concierge
export const MODEL_RETRIEVAL      = OPENAI_MINI;   // retrieval reranker
export const MODEL_INTERVIEW      = OPENAI_CHAT;   // interview QA

// ── Model family predicates ───────────────────────────────────────────────
// Kept here so call sites never need to hardcode model-prefix strings.
// Gemini 3.x (3-flash-preview, 3.1-pro-preview, …) warn that sub-1.0
// temperatures cause looping; callers must omit the temperature field
// entirely for these models and let the server use its default.

/** True when the model belongs to the Gemini 3.x family. */
export function isGemini3Model(model: string): boolean {
  // eslint-disable-next-line no-useless-escape
  return /^gemini-3(\.\d+)?(-|$)/.test(model);
}
