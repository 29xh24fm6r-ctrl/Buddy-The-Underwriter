import "server-only";

/**
 * Gemini-Primary Extraction Client
 *
 * Thin wrapper around Vertex AI Gemini 3.1 Flash-Lite for primary fact
 * extraction. Reuses auth chain from geminiFlashStructuredAssist.ts.
 *
 * Model: gemini-3.1-flash-lite (GA, since May 7, 2026)
 * Vertex location: `us` multi-region (REQUIRED — not deployed to us-central1)
 *
 * NEVER THROWS — returns { ok: false, failureReason } on any failure.
 */

import { VertexAI } from "@google-cloud/vertexai";
import {
  ensureGcpAdcBootstrap,
  getVertexAuthOptions,
} from "@/lib/gcpAdcBootstrap";
import { MODEL_EXTRACTION, isGemini3Model } from "@/lib/ai/models";
import type { GeminiExtractionPrompt } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_MODEL = MODEL_EXTRACTION;
const GEMINI_TEMPERATURE = 0.0; // deterministic — lower than advisory's 0.1
const GEMINI_PRIMARY_TIMEOUT_MS = 45_000; // 45s hard timeout (native PDF processing is heavier)
const MAX_RETRIES = 1;


// ---------------------------------------------------------------------------
// GCP helpers (same pattern as geminiFlashStructuredAssist.ts)
// ---------------------------------------------------------------------------

function getGoogleProjectId(): string {
  const projectId =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    process.env.GCS_PROJECT_ID ||
    process.env.GCP_PROJECT_ID;
  if (!projectId) {
    throw new Error(
      "Missing Google Cloud project id. Set GOOGLE_CLOUD_PROJECT.",
    );
  }
  return projectId;
}

function getGoogleLocation(): string {
  // SPEC-GEMINI-FLASH-LITE-MIGRATION-1: changed default from "us-central1"
  // to "us" multi-region. gemini-3.1-flash-lite is deployed to
  // global/us/eu multi-region endpoints, NOT to regional endpoints like
  // us-central1. Empirical: every call to us-central1 returned
  // 404 Publisher Model not found for project buddy-the-underwriter.
  // "us" multi-region preserves US data residency (relevant for SBA/bank
  // tenant compliance) while solving the availability gap.
  return (
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.GOOGLE_CLOUD_REGION ||
    "us"
  );
}

// ---------------------------------------------------------------------------
// Strict retry instruction
// ---------------------------------------------------------------------------

const STRICT_RETRY_INSTRUCTION =
  "You are a financial document extraction engine. " +
  "Return ONLY valid JSON matching the exact schema requested. " +
  "No commentary. No markdown. No explanation. " +
  'The response must be a JSON object with "facts" and "metadata" keys. ' +
  "Use null for any value you cannot extract with certainty.";

// ---------------------------------------------------------------------------
// JSON parser (defensive)
// ---------------------------------------------------------------------------

function parseJsonSafe(text: string): unknown | null {
  try {
    let cleaned = text.trim();
    if (cleaned.startsWith("```json")) cleaned = cleaned.slice(7);
    else if (cleaned.startsWith("```")) cleaned = cleaned.slice(3);
    if (cleaned.endsWith("```")) cleaned = cleaned.slice(0, -3);
    cleaned = cleaned.trim();
    return JSON.parse(cleaned);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export type GeminiClientResult = {
  ok: boolean;
  rawJson: unknown;
  latencyMs: number;
  model: string;
  failureReason?: string;
};

export async function callGeminiForExtraction(args: {
  prompt: GeminiExtractionPrompt;
  documentId: string;
  /** When present, sends native PDF via inlineData instead of OCR text in prompt */
  pdfBase64?: string;
  mimeType?: string;
}): Promise<GeminiClientResult> {
  const started = Date.now();

  try {
    await ensureGcpAdcBootstrap();
    const googleAuthOptions = await getVertexAuthOptions();
    const vertexAI = new VertexAI({
      project: getGoogleProjectId(),
      location: getGoogleLocation(),
      ...(googleAuthOptions
        ? { googleAuthOptions: googleAuthOptions as any }
        : {}),
    });

    let lastFailureReason: string | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const isRetry = attempt > 0;
      const systemInstruction = isRetry
        ? STRICT_RETRY_INSTRUCTION
        : args.prompt.systemInstruction;

      // Phase 93 follow-up: Gemini 3.x rejects sub-1.0 temperatures.
      // SPEC-GEMINI-EXTRACTION-CONFIG-FIX-1: explicit thinkingLevel + maxOutputTokens
      // + mediaResolution. Without maxOutputTokens, Gemini 3 Flash's dynamic
      // thinking can consume the SDK's default output budget through reasoning
      // alone, returning candidates with no text part. Without mediaResolution,
      // small print on tax-return detail schedules (Form 1125-A COGS, Schedule L)
      // downsamples below readable resolution.
      const generationConfig: Record<string, unknown> = {
        responseMimeType: "application/json",
        // SPEC-GEMINI-FLASH-LITE-MIGRATION-1: bumped from 8192 to 16384.
        // gemini-3.1-flash-lite supports up to 65535 output tokens. Tax-return
        // JSON output (Form 1120 with Schedule L, M-1, M-2, Form 1125-A) plus
        // model reasoning can exceed 8K. 16K leaves headroom without inviting
        // runaway thinking budget consumption.
        maxOutputTokens: 16384,
      };
      if (isGemini3Model(GEMINI_MODEL)) {
        // Gemini 3 Flash supports minimal | low | medium | high.
        // "low" is the right balance for extraction: enough reasoning to handle
        // multi-page tax returns, not so much that latency budget burns through.
        generationConfig.thinkingConfig = { thinkingLevel: "low" };
        // PDF tax-return detail schedules need high resolution to read line items.
        // Only applies when args.pdfBase64 is present.
        if (args.pdfBase64) {
          generationConfig.mediaResolution = "MEDIA_RESOLUTION_HIGH";
        }
      } else {
        generationConfig.temperature = isRetry ? 0.0 : GEMINI_TEMPERATURE;
      }
      const model = vertexAI.getGenerativeModel({
        model: GEMINI_MODEL,
        generationConfig,
      });

      // Native PDF path: send the actual document as inlineData + instructions
      // OCR text path: prompt already contains embedded OCR text
      const userParts = args.pdfBase64
        ? [
            {
              inlineData: {
                mimeType: args.mimeType ?? "application/pdf",
                data: args.pdfBase64,
              },
            },
            { text: args.prompt.userPrompt },
          ]
        : [{ text: args.prompt.userPrompt }];

      const generatePromise = model.generateContent({
        contents: [
          {
            role: "user",
            parts: userParts as any,
          },
        ],
        systemInstruction: {
          role: "system",
          parts: [{ text: systemInstruction }],
        },
      });

      // Hard timeout
      const resp = await Promise.race([
        generatePromise,
        new Promise<never>((_resolve, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  `gemini_primary_timeout_${GEMINI_PRIMARY_TIMEOUT_MS}ms`,
                ),
              ),
            GEMINI_PRIMARY_TIMEOUT_MS,
          ),
        ),
      ]);

      const candidate = (resp as any)?.response?.candidates?.[0];
      const parts = candidate?.content?.parts ?? [];
      const rawText = parts
        .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
        .join("")
        .trim();

      if (!rawText) {
        // SPEC-GEMINI-EXTRACTION-CONFIG-FIX-1: capture finishReason + safetyRatings
        // so the failure mode is visible in deal_extraction_runs.failure_detail
        // instead of collapsing into UNKNOWN_FATAL with null detail.
        const finishReason: string | undefined = candidate?.finishReason;
        const safetyRatings: unknown = candidate?.safetyRatings;
        const promptFeedback: unknown = (resp as any)?.response?.promptFeedback;

        // Tag the failure reason so the orchestrator's mapFailureReasonToCode
        // can route this to STRUCTURED_EMPTY_RESPONSE instead of UNKNOWN_FATAL.
        // Suffix with finishReason when present so the detail reaches the ledger.
        lastFailureReason = finishReason
          ? `empty_response:${finishReason}`
          : "empty_response";

        console.warn("[GeminiClient] Empty response", {
          documentId: args.documentId,
          attempt,
          finishReason,
          safetyRatings,
          promptFeedback,
          hasCandidate: !!candidate,
          partsCount: parts.length,
        });
        continue;
      }

      const parsed = parseJsonSafe(rawText);
      if (!parsed) {
        lastFailureReason = "invalid_json";
        console.warn("[GeminiClient] Invalid JSON", {
          documentId: args.documentId,
          rawLength: rawText.length,
          attempt,
        });
        continue;
      }

      // Basic shape validation: must have facts object
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        !("facts" in (parsed as Record<string, unknown>))
      ) {
        lastFailureReason = "missing_facts_key";
        console.warn("[GeminiClient] Response missing 'facts' key", {
          documentId: args.documentId,
          attempt,
        });
        continue;
      }

      const latencyMs = Date.now() - started;
      console.log("[GeminiClient] Extraction completed", {
        documentId: args.documentId,
        latencyMs,
        attempt,
        promptVersion: args.prompt.promptVersion,
        inputMode: args.pdfBase64 ? "native_pdf" : "ocr_text",
      });

      return {
        ok: true,
        rawJson: parsed,
        latencyMs,
        model: GEMINI_MODEL,
      };
    }

    // All attempts exhausted
    return {
      ok: false,
      rawJson: null,
      latencyMs: Date.now() - started,
      model: GEMINI_MODEL,
      failureReason: lastFailureReason ?? "all_attempts_failed",
    };
  } catch (err: any) {
    const latencyMs = Date.now() - started;
    console.warn("[GeminiClient] Failed", {
      documentId: args.documentId,
      error: err?.message || String(err),
      latencyMs,
    });
    return {
      ok: false,
      rawJson: null,
      latencyMs,
      model: GEMINI_MODEL,
      failureReason: err?.message || "unknown_error",
    };
  }
}
