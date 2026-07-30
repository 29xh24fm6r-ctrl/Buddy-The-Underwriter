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

import { MODEL_EXTRACTION, isGemini3Model } from "@/lib/ai/models";
import { classifySdkError } from "@/lib/extraction/sdkResponseGuard";
import { runRole } from "@/lib/ai/gateway";
import type { GeminiExtractionPrompt } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GEMINI_MODEL = MODEL_EXTRACTION;
const GEMINI_TEMPERATURE = 0.0; // deterministic — lower than advisory's 0.1
const GEMINI_PRIMARY_TIMEOUT_MS = 45_000; // 45s hard timeout (native PDF processing is heavier)
const MAX_RETRIES = 1;

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
    let lastFailureReason: string | null = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const isRetry = attempt > 0;
      const systemInstruction = isRetry
        ? STRICT_RETRY_INSTRUCTION
        : args.prompt.systemInstruction;

      // SPEC-M1.1: routed through the AI gateway (runRole, "generator" role,
      // authMode: "vertex"). maxOutputTokens/thinkingLevel/mediaResolution
      // preserve the incident-driven tuning documented above (16K output
      // budget for reasoning + JSON; "low" thinking; MEDIA_RESOLUTION_HIGH
      // for native-PDF small print) — temperature omission and
      // thinkingConfig/mediaResolution construction for Gemini 3.x models
      // are already handled inside providers/google.ts (mediaResolution
      // support added here as a SPEC-M1.1 gateway capability, this file
      // being its first real caller).
      let rawText: string;
      let finishReasonFromError: string | undefined;
      try {
        const result = await runRole("generator", {
          purpose: "financial_spread_extraction",
          prompt: args.prompt.userPrompt,
          systemInstruction,
          modelOverride: GEMINI_MODEL,
          authMode: "vertex",
          maxOutputTokens: 16384,
          thinkingLevel: "low",
          mediaResolution:
            isGemini3Model(GEMINI_MODEL) && args.pdfBase64
              ? "MEDIA_RESOLUTION_HIGH"
              : undefined,
          temperature: isRetry ? 0.0 : GEMINI_TEMPERATURE,
          timeoutMs: GEMINI_PRIMARY_TIMEOUT_MS,
          responseSchema: { type: "object" },
          // Native PDF path: send the actual document as inlineData.
          // OCR text path: prompt already contains embedded OCR text.
          inlineData: args.pdfBase64
            ? [{ mimeType: args.mimeType ?? "application/pdf", data: args.pdfBase64 }]
            : undefined,
        });
        rawText = result.text.trim();
      } catch (attemptErr: any) {
        // SPEC-GEMINI-EXTRACTION-CONFIG-FIX-1: providers/google.ts throws
        // "empty response" (optionally suffixed "(finishReason: X)") for a
        // blank candidate — extract that finishReason here so the failure
        // mode is still visible in deal_extraction_runs.failure_detail
        // instead of collapsing into UNKNOWN_FATAL. safetyRatings/
        // promptFeedback are no longer available at this layer (disclosed,
        // not silent — the gateway's ProviderCallResult doesn't carry them).
        const msg = attemptErr?.message ? String(attemptErr.message) : "";
        const emptyMatch = /^empty response(?: \(finishReason: (.+)\))?$/.exec(msg);
        if (!emptyMatch) throw attemptErr;
        finishReasonFromError = emptyMatch[1];
        rawText = "";
      }

      if (!rawText) {
        lastFailureReason = finishReasonFromError
          ? `empty_response:${finishReasonFromError}`
          : "empty_response";

        console.warn("[GeminiClient] Empty response", {
          documentId: args.documentId,
          attempt,
          finishReason: finishReasonFromError,
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
    // SPEC-VERTEX-SDK-MIGRATION-1: classify SDK errors so the
    // HTML-response failure mode surfaces with a stable code.
    const classification = classifySdkError(err);
    if (classification.isHtmlResponse) {
      console.error("[GeminiClient] SDK_HTML_RESPONSE — Vertex returned HTML where JSON expected", {
        documentId: args.documentId,
        rawSnippet: classification.rawSnippet,
        code: classification.code,
        latencyMs,
      });
      return {
        ok: false,
        rawJson: null,
        latencyMs,
        model: GEMINI_MODEL,
        failureReason: `SDK_HTML_RESPONSE:${classification.rawSnippet.slice(0, 80)}`,
      };
    }
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
