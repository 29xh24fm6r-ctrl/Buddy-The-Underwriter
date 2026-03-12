/**
 * Classification Shadow Mode — Gemini vs OpenAI comparison logging
 *
 * Runs the Gemini classifier in parallel with the primary OpenAI result.
 * Logs agreement/disagreement to classification_shadow_log for analysis.
 *
 * Shadow mode NEVER affects production routing — the primary (OpenAI) result
 * is always authoritative. This is instrumentation only.
 *
 * inputPath values:
 *   "text"    — primary used OCR text path (live API call)
 *   "vision"  — primary used vision/image path (live API call)
 *   "cache"   — primary result came from gatekeeper cache (no live call)
 *
 * For "cache" path: shadow runs text classifier if ocrText is available.
 * If neither ocrText nor imageBase64 is present, shadow result is null
 * (still logged — the primary_type is still recorded for pattern analysis).
 *
 * Phase 24 will flip primary to Gemini after shadow data confirms ≥95% agree rate.
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { classifyWithGeminiText, classifyWithGeminiVision } from "./geminiClassifier";

// ─── Shadow Runner ──────────────────────────────────────────────────────────

/**
 * Fire-and-forget shadow classification.
 * Runs Gemini classifier and logs comparison. Never throws.
 */
export function runClassificationShadow(args: {
  dealId: string;
  documentId: string;
  filename: string;
  /** Which path the primary classifier used */
  inputPath: "text" | "vision" | "cache";
  /** OCR text (used for text and cache paths) */
  ocrText?: string | null;
  /** Base64 image (used for vision path) */
  imageBase64?: string | null;
  /** MIME type (required for vision path) */
  mimeType?: string;
  /** Primary classifier result */
  primaryDocType: string;
  primaryConfidence: number;
  primaryModel: string;
}): void {
  // Fire and forget — never block the pipeline
  runShadowAsync(args).catch(() => {});
}

async function runShadowAsync(args: {
  dealId: string;
  documentId: string;
  filename: string;
  inputPath: "text" | "vision" | "cache";
  ocrText?: string | null;
  imageBase64?: string | null;
  mimeType?: string;
  primaryDocType: string;
  primaryConfidence: number;
  primaryModel: string;
}): Promise<void> {
  let shadowResult: { doc_type: string; confidence: number } | null = null;

  try {
    if (args.inputPath === "text" && args.ocrText) {
      // Live text path — run Gemini text classifier
      shadowResult = await classifyWithGeminiText(args.ocrText);
    } else if (args.inputPath === "vision" && args.imageBase64 && args.mimeType) {
      // Live vision path — run Gemini vision classifier
      shadowResult = await classifyWithGeminiVision(args.imageBase64, args.mimeType);
    } else if (args.inputPath === "cache" && args.ocrText) {
      // Cache hit path — primary was served from cache, but we still have OCR text.
      // Run Gemini text classifier so cache hits contribute shadow data.
      shadowResult = await classifyWithGeminiText(args.ocrText);
    }
    // If inputPath === "cache" and no ocrText/imageBase64: shadowResult stays null.
    // We still log the row so primary_type is recorded — useful for volume metrics
    // even without a shadow comparison.
  } catch {
    // Shadow failure is always silent
  }

  const sb = supabaseAdmin();
  await (sb as any).from("classification_shadow_log").insert({
    deal_id: args.dealId,
    document_id: args.documentId,
    filename: args.filename,
    primary_model: args.primaryModel,
    primary_type: args.primaryDocType,
    primary_confidence: args.primaryConfidence,
    shadow_model: "gemini-2.0-flash",
    shadow_type: shadowResult?.doc_type ?? null,
    shadow_confidence: shadowResult?.confidence ?? null,
    agree: shadowResult != null
      ? args.primaryDocType === shadowResult.doc_type
      : false,
  });
}
