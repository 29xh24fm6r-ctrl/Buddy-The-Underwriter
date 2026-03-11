/**
 * Classification Shadow Mode — Gemini vs OpenAI comparison logging
 *
 * Runs the Gemini classifier in parallel with the primary OpenAI result.
 * Logs agreement/disagreement to classification_shadow_log for analysis.
 *
 * Shadow mode NEVER affects production routing — the primary (OpenAI) result
 * is always authoritative. This is instrumentation only.
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
  inputPath: "text" | "vision";
  /** OCR text (for text path) */
  ocrText?: string | null;
  /** Base64 image (for vision path) */
  imageBase64?: string | null;
  /** MIME type (for vision path) */
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
  inputPath: "text" | "vision";
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
      shadowResult = await classifyWithGeminiText(args.ocrText);
    } else if (args.inputPath === "vision" && args.imageBase64 && args.mimeType) {
      shadowResult = await classifyWithGeminiVision(args.imageBase64, args.mimeType);
    }
  } catch {
    // Shadow failure is silent
  }

  // Log to DB regardless of shadow success/failure
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
    agree: shadowResult ? args.primaryDocType === shadowResult.doc_type : false,
  });
}
