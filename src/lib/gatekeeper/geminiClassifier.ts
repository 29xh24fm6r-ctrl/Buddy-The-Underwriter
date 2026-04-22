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
 */
import "server-only";

import {
  SYSTEM_PROMPT,
  GEMINI_MODEL,
  parseGeminiResult,
  type GeminiClassifyResult,
} from "./geminiClassifierPure";

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

// ─── Gemini HTTP ────────────────────────────────────────────────────────────

function geminiUrl(apiKey: string) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;
}

// ─── Text Path ──────────────────────────────────────────────────────────────

export async function classifyWithGeminiText(
  ocrText: string,
): Promise<GeminiClassifyResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[GeminiClassifier][text] GEMINI_API_KEY missing");
    return null;
  }

  const truncated = truncateText(ocrText);

  try {
    const resp = await fetch(geminiUrl(apiKey), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{
            text: `${SYSTEM_PROMPT}\n\nClassify this document:\n\n${truncated}`,
          }],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.0,
          maxOutputTokens: 2048,
          thinkingConfig: {
            thinkingLevel: "low",
          },
        },
      }),
    });

    if (!resp.ok) {
      const bodyPreview = await resp.text().catch(() => "<unreadable>");
      console.warn("[GeminiClassifier][text] non-ok HTTP response", {
        status: resp.status,
        statusText: resp.statusText,
        bodyPreview: bodyPreview.slice(0, 500),
        model: GEMINI_MODEL,
      });
      return null;
    }

    const json = await resp.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const finishReason = json.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== "STOP") {
      console.warn("[GeminiClassifier][text] unexpected finishReason on success path", {
        finishReason,
        ocrTextLength: ocrText.length,
      });
    }
    const result = parseGeminiResult(text);
    if (!result) {
      console.warn("[GeminiClassifier][text] parseGeminiResult returned null", {
        finishReason,
        rawTextPreview: String(text).slice(0, 500),
        ocrTextLength: ocrText.length,
      });
    }
    return result;
  } catch (err) {
    console.warn("[GeminiClassifier][text] fetch or parse threw", {
      error: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : "unknown",
      ocrTextLength: ocrText.length,
    });
    return null;
  }
}

// ─── Vision Path ────────────────────────────────────────────────────────────

export async function classifyWithGeminiVision(
  imageBase64: string,
  mimeType: string,
): Promise<GeminiClassifyResult | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("[GeminiClassifier][vision] GEMINI_API_KEY missing");
    return null;
  }

  try {
    const resp = await fetch(geminiUrl(apiKey), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: `${SYSTEM_PROMPT}\n\nClassify this document:` },
            { inlineData: { mimeType, data: imageBase64 } },
          ],
        }],
        generationConfig: {
          responseMimeType: "application/json",
          temperature: 0.0,
          maxOutputTokens: 2048,
          thinkingConfig: {
            thinkingLevel: "low",
          },
        },
      }),
    });

    if (!resp.ok) {
      const bodyPreview = await resp.text().catch(() => "<unreadable>");
      console.warn("[GeminiClassifier][vision] non-ok HTTP response", {
        status: resp.status,
        statusText: resp.statusText,
        bodyPreview: bodyPreview.slice(0, 500),
        model: GEMINI_MODEL,
        mimeType,
      });
      return null;
    }

    const json = await resp.json();
    const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    const finishReason = json.candidates?.[0]?.finishReason;
    if (finishReason && finishReason !== "STOP") {
      console.warn("[GeminiClassifier][vision] unexpected finishReason on success path", {
        finishReason,
        mimeType,
      });
    }
    const result = parseGeminiResult(text);
    if (!result) {
      console.warn("[GeminiClassifier][vision] parseGeminiResult returned null", {
        finishReason,
        rawTextPreview: String(text).slice(0, 500),
        mimeType,
      });
    }
    return result;
  } catch (err) {
    console.warn("[GeminiClassifier][vision] fetch or parse threw", {
      error: err instanceof Error ? err.message : String(err),
      errorName: err instanceof Error ? err.name : "unknown",
      mimeType,
    });
    return null;
  }
}
