/**
 * Gemini Gatekeeper — Classification via Gemini 2.0 Flash
 *
 * Shadow-mode counterpart to classifyWithOpenAI.ts.
 * Two paths:
 * - Text: when OCR text is available
 * - Vision: when no OCR text, sends base64 image
 *
 * Returns the same GatekeeperClassification shape so results are directly
 * comparable with the OpenAI primary classifier.
 *
 * Pure utilities (SYSTEM_PROMPT, prompt hash, parseGeminiResult,
 * normalizeEntityName, version constants) live in geminiClassifierPure.ts
 * so they can be unit tested without pulling in "server-only". This file
 * only holds the HTTP side.
 *
 * SPEC-M1.1: routed through the AI gateway (runRole, "generator" role).
 * GEMINI_MODEL (MODEL_CLASSIFICATION) already equals the generator role's
 * default chain model, so no modelOverride is needed. Both call sites keep
 * their own try/catch-returns-null contract — callers pattern-match on
 * `!result`, not on a thrown exception.
 *
 * classifyWithGeminiVision's inlineData is Google-only — the gateway skips
 * generator's openai fallback step entirely for an inlineData request
 * (SPEC-M1.1 fix to runRole()), so a google failure surfaces directly here
 * rather than being masked by openai's generic "unsupported" rejection.
 * Either way this file's own try/catch still yields null on any failure,
 * same external contract as before this migration.
 */
import "server-only";

import {
  SYSTEM_PROMPT,
  GEMINI_MODEL,
  parseGeminiResult,
  type GeminiClassifyResult,
} from "./geminiClassifierPure";
import { runRole } from "@/lib/ai/gateway";

// ─── Config ─────────────────────────────────────────────────────────────────

/** Max text chars for head+tail truncation (mirrors OpenAI classifier). */
const HEAD_CHARS = 8_000;
const TAIL_CHARS = 4_000;

// ─── Re-exports (back-compat for callers that imported from this module) ────

export {
  GEMINI_PROMPT_VERSION,
  getGeminiPromptHash,
  getGeminiPromptVersion,
  normalizeEntityName,
  parseGeminiResult,
  type GeminiClassifyResult,
} from "./geminiClassifierPure";

// ─── Text Truncation ────────────────────────────────────────────────────────

function truncateText(text: string): string {
  const max = HEAD_CHARS + TAIL_CHARS;
  if (text.length <= max) return text;

  const head = text.slice(0, HEAD_CHARS);
  const tail = text.slice(-TAIL_CHARS);
  return head + "\n\n[... truncated ...]\n\n" + tail;
}

// ─── Text Path ──────────────────────────────────────────────────────────────

export async function classifyWithGeminiText(
  ocrText: string,
): Promise<GeminiClassifyResult | null> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("[GeminiClassifier][text] GEMINI_API_KEY missing");
    return null;
  }

  const truncated = truncateText(ocrText);

  try {
    const result = await runRole("generator", {
      purpose: "gatekeeper_classify_text",
      prompt: `${SYSTEM_PROMPT}\n\nClassify this document:\n\n${truncated}`,
      temperature: 0.0,
      maxOutputTokens: 2048,
      thinkingLevel: "low",
      responseSchema: { type: "object" },
    });

    const parsed = parseGeminiResult(result.text);
    if (!parsed) {
      console.warn("[GeminiClassifier][text] parseGeminiResult returned null", {
        rawTextPreview: result.text.slice(0, 500),
        ocrTextLength: ocrText.length,
      });
    }
    return parsed;
  } catch (err) {
    console.warn("[GeminiClassifier][text] gateway call threw", {
      error: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : "unknown",
      ocrTextLength: ocrText.length,
      model: GEMINI_MODEL,
    });
    return null;
  }
}

// ─── Vision Path ────────────────────────────────────────────────────────────

export async function classifyWithGeminiVision(
  imageBase64: string,
  mimeType: string,
): Promise<GeminiClassifyResult | null> {
  if (!process.env.GEMINI_API_KEY) {
    console.warn("[GeminiClassifier][vision] GEMINI_API_KEY missing");
    return null;
  }

  try {
    const result = await runRole("generator", {
      purpose: "gatekeeper_classify_vision",
      prompt: `${SYSTEM_PROMPT}\n\nClassify this document:`,
      inlineData: [{ mimeType, data: imageBase64 }],
      temperature: 0.0,
      maxOutputTokens: 2048,
      thinkingLevel: "low",
      responseSchema: { type: "object" },
    });

    const parsed = parseGeminiResult(result.text);
    if (!parsed) {
      console.warn("[GeminiClassifier][vision] parseGeminiResult returned null", {
        rawTextPreview: result.text.slice(0, 500),
        mimeType,
      });
    }
    return parsed;
  } catch (err) {
    console.warn("[GeminiClassifier][vision] gateway call threw", {
      error: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : "unknown",
      mimeType,
      model: GEMINI_MODEL,
    });
    return null;
  }
}
