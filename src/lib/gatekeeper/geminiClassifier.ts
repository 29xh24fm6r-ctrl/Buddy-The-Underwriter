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
 * Pure function. No DB writes. No routing logic.
 */
import "server-only";

import { createHash } from "crypto";
import type { GatekeeperClassification } from "./types";
import { MODEL_CLASSIFICATION } from "@/lib/ai/models";

// ─── Config ─────────────────────────────────────────────────────────────────

const GEMINI_MODEL = MODEL_CLASSIFICATION;

/** Max text chars for head+tail truncation (mirrors OpenAI classifier). */
const HEAD_CHARS = 8_000;
const TAIL_CHARS = 4_000;

// ─── Result Type ────────────────────────────────────────────────────────────

export type GeminiClassifyResult = GatekeeperClassification & {
  model: string;
};

// ─── Prompt ─────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a document classifier for a commercial bank underwriting pipeline.
Given a document (text or image), classify it into exactly one doc_type.
Return ONLY valid JSON matching the provided schema.

CLASSIFICATION RULES:
- BUSINESS_TAX_RETURN: IRS Forms 1120, 1120-S, 1065, and their schedules (NOT K-1)
- PERSONAL_TAX_RETURN: IRS Form 1040 and its schedules (NOT K-1, NOT W-2, NOT 1099)
- W2: W-2 Wage and Tax Statement
- FORM_1099: Any 1099 variant (1099-INT, 1099-DIV, 1099-MISC, 1099-NEC, etc.)
- K1: Schedule K-1 (from 1065, 1120-S, or trust)
- BANK_STATEMENT: Monthly/quarterly bank account statements
- FINANCIAL_STATEMENT: P&L, income statement, balance sheet, T12, interim financials (NOT personal financial statements — see PERSONAL_FINANCIAL_STATEMENT)
- PERSONAL_FINANCIAL_STATEMENT: Personal Financial Statement, SBA Form 413, guarantor statement of assets and liabilities, personal balance sheet listing an individual's net worth. Key signals: guarantor/borrower name with personal assets, personal liabilities, and net worth summary.
- DRIVERS_LICENSE: Government-issued photo ID (driver's license, state ID, passport)
- VOIDED_CHECK: Voided check for direct deposit / ACH setup
- OTHER: Identifiable document that doesn't fit above categories (lease, insurance, appraisal, etc.)
- UNKNOWN: Cannot determine document type with any confidence

CONFIDENCE RULES:
- 0.95-1.00: Certain (form number clearly visible, unambiguous)
- 0.80-0.94: High confidence (strong signals, minor ambiguity)
- 0.60-0.79: Moderate (some ambiguity, partial signals)
- Below 0.60: Low confidence (unclear, barely readable)

TAX YEAR EXTRACTION:
- Extract the tax year FROM the document (calendar year / fiscal year / "for the year ending")
- IGNORE signature date or filing date if they conflict with the tax year
- Return null if tax year cannot be determined

FORM NUMBERS:
- List any IRS/government form numbers found (e.g., ["1120-S", "Schedule K"])

DETECTED SIGNALS:
- has_ein: true if an EIN (XX-XXXXXXX) pattern is visible
- has_ssn: true if a SSN (XXX-XX-XXXX) pattern is visible (even if partially redacted)

Respond with ONLY valid JSON matching this exact schema:
{"doc_type": "BUSINESS_TAX_RETURN", "confidence": 0.95, "tax_year": 2024, "reasons": ["Form 1065 visible"], "detected_signals": {"form_numbers": ["1065"], "has_ein": true, "has_ssn": false}}`;

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

// ─── Prompt Version / Hash (mirrors classifyWithOpenAI.ts exports) ───────────

/** Version string stamped on cache rows and deal_documents. */
export const GEMINI_PROMPT_VERSION = "gemini_classifier_v1";

let _geminiPromptHashCache: string | null = null;

/**
 * Deterministic prompt hash for cache keying.
 * Changing the system prompt must change this value to bust the cache.
 */
export function getGeminiPromptHash(): string {
  if (!_geminiPromptHashCache) {
    _geminiPromptHashCache = createHash("sha256")
      .update(SYSTEM_PROMPT.slice(0, 120))
      .digest("hex")
      .slice(0, 16);
  }
  return _geminiPromptHashCache;
}

export function getGeminiPromptVersion(): string {
  return GEMINI_PROMPT_VERSION;
}

// ─── Response Parser ────────────────────────────────────────────────────────

function parseGeminiResult(text: string): GeminiClassifyResult | null {
  try {
    const parsed = JSON.parse(text);
    return {
      doc_type: parsed.doc_type ?? "UNKNOWN",
      confidence: Number(parsed.confidence ?? 0.5),
      tax_year: parsed.tax_year ?? null,
      reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
      detected_signals: {
        form_numbers: Array.isArray(parsed.detected_signals?.form_numbers)
          ? parsed.detected_signals.form_numbers
          : [],
        has_ein: Boolean(parsed.detected_signals?.has_ein),
        has_ssn: Boolean(parsed.detected_signals?.has_ssn),
      },
      model: GEMINI_MODEL,
    };
  } catch {
    return null;
  }
}
