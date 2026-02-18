/**
 * OpenAI Gatekeeper — Classification via OpenAI Structured Outputs
 *
 * Two paths:
 * - Text: when OCR text is available (cheaper, ~$0.001/doc)
 * - Vision: when no OCR text, sends base64 image (costlier, ~$0.005/doc)
 *
 * Uses response_format: { type: "json_schema", strict: true } for deterministic
 * JSON output matching GatekeeperClassificationSchema.
 *
 * Model is config-driven via OPENAI_GATEKEEPER_MODEL env var (default: gpt-4o-mini).
 * Prompt version and hash are tracked for cache invalidation and auditing.
 *
 * Resilience: Wrapped with withOpenAIResilience for retry, circuit breaker,
 * and per-request trace IDs.
 */
import "server-only";

import crypto from "node:crypto";
import { zodResponseFormat } from "openai/helpers/zod";
import { getOpenAI, openaiRequestHeaders } from "@/lib/ai/openaiClient";
import { withOpenAIResilience } from "@/lib/ai/openaiResilience";
import { GatekeeperClassificationSchema } from "./schema";
import type { GatekeeperClassification } from "./types";

// ─── Config ─────────────────────────────────────────────────────────────────

const DEFAULT_MODEL = "gpt-4o-mini";
const PROMPT_VERSION = "gatekeeper_v2";

/** Max text chars for head+tail truncation. */
const HEAD_CHARS = 8_000;
const TAIL_CHARS = 4_000;

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
- has_ssn: true if a SSN (XXX-XX-XXXX) pattern is visible (even if partially redacted)`;

// ─── Prompt Hash (cached) ────────────────────────────────────────────────────

let _promptHashCache: string | null = null;

/** SHA-256 of prompt + schema for cache invalidation. */
export function getPromptHash(): string {
  if (!_promptHashCache) {
    const schemaStr = JSON.stringify(GatekeeperClassificationSchema.shape);
    const combined = SYSTEM_PROMPT + "\n---\n" + schemaStr;
    _promptHashCache = crypto
      .createHash("sha256")
      .update(combined)
      .digest("hex")
      .slice(0, 16); // First 16 hex chars (64 bits) — enough for invalidation
  }
  return _promptHashCache;
}

export function getPromptVersion(): string {
  return PROMPT_VERSION;
}

export function getGatekeeperModel(): string {
  return process.env.OPENAI_GATEKEEPER_MODEL || DEFAULT_MODEL;
}

// ─── Text Truncation ────────────────────────────────────────────────────────

/** Head+tail truncation: first ~8K chars + last ~4K chars. */
function truncateText(text: string): string {
  const max = HEAD_CHARS + TAIL_CHARS;
  if (text.length <= max) return text;

  const head = text.slice(0, HEAD_CHARS);
  const tail = text.slice(-TAIL_CHARS);
  return head + "\n\n[... truncated ...]\n\n" + tail;
}

// ─── Result Type ────────────────────────────────────────────────────────────

export type OpenAIClassifyResult = GatekeeperClassification & {
  model: string;
  prompt_version: string;
  prompt_hash: string;
  prompt_tokens?: number;
  completion_tokens?: number;
};

// ─── Text Path ──────────────────────────────────────────────────────────────

/**
 * Classify using OCR text. Cheaper path (~$0.001/doc).
 * Text is truncated with head+tail strategy to preserve tax year
 * which sometimes appears near the end of the document.
 */
export async function classifyWithOpenAIText(
  ocrText: string,
): Promise<OpenAIClassifyResult> {
  const model = getGatekeeperModel();
  const truncated = truncateText(ocrText);

  return withOpenAIResilience("gatekeeper_text", async (ids) => {
    const client = getOpenAI();

    const completion = await client.chat.completions.parse(
      {
        model,
        temperature: 0.0,
        max_tokens: 512,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Classify this document:\n\n${truncated}` },
        ],
        response_format: zodResponseFormat(
          GatekeeperClassificationSchema,
          "GatekeeperClassification",
        ),
      },
      { headers: openaiRequestHeaders(ids) },
    );

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) throw new Error("Gatekeeper structured output missing parsed result");

    return {
      ...parsed,
      model,
      prompt_version: PROMPT_VERSION,
      prompt_hash: getPromptHash(),
      prompt_tokens: completion.usage?.prompt_tokens ?? undefined,
      completion_tokens: completion.usage?.completion_tokens ?? undefined,
    };
  });
}

// ─── Vision Path ────────────────────────────────────────────────────────────

/**
 * Classify using vision (image input). Costlier path (~$0.005/doc).
 * Used when OCR text is not available (e.g., freshly uploaded image files).
 * Uses `detail: "low"` to minimize token cost (classification doesn't need high-res).
 *
 * NOTE: This works for image files (JPG/PNG/TIFF/WEBP). For PDFs without OCR,
 * the caller must render page 1 to an image first, or route to NEEDS_REVIEW.
 */
export async function classifyWithOpenAIVision(
  imageBase64: string,
  mimeType: string,
): Promise<OpenAIClassifyResult> {
  const model = getGatekeeperModel();
  const dataUrl = `data:${mimeType};base64,${imageBase64}`;

  return withOpenAIResilience("gatekeeper_vision", async (ids) => {
    const client = getOpenAI();

    const completion = await client.chat.completions.parse(
      {
        model,
        temperature: 0.0,
        max_tokens: 512,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: "Classify this document:" },
              {
                type: "image_url",
                image_url: { url: dataUrl, detail: "low" },
              },
            ],
          },
        ],
        response_format: zodResponseFormat(
          GatekeeperClassificationSchema,
          "GatekeeperClassification",
        ),
      },
      { headers: openaiRequestHeaders(ids) },
    );

    const parsed = completion.choices[0]?.message?.parsed;
    if (!parsed) throw new Error("Gatekeeper structured output missing parsed result (vision)");

    return {
      ...parsed,
      model,
      prompt_version: PROMPT_VERSION,
      prompt_hash: getPromptHash(),
      prompt_tokens: completion.usage?.prompt_tokens ?? undefined,
      completion_tokens: completion.usage?.completion_tokens ?? undefined,
    };
  });
}
