/**
 * Gemini Gatekeeper — Per-Document Orchestrator
 *
 * Runs gatekeeper classification for a single document:
 * 1. Idempotency check (already classified?)
 * 2. Cache check by (bank_id, sha256, prompt_hash)
 * 3. Gemini call (text or vision path)
 * 4. Apply deterministic routing rules
 * 5. Stamp ONLY gatekeeper_* fields on deal_documents (never canonical_type/routing_class)
 * 6. Write cache + ledger events
 *
 * Phase 24: Gemini 2.0 Flash is the primary classifier. OpenAI removed from path.
 * Fail-closed: any error → route = NEEDS_REVIEW, never blocks the deal.
 */
import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { writeEvent } from "@/lib/ledger/writeEvent";
import { readGatekeeperCache, writeGatekeeperCache } from "./gatekeeperCache";
import {
  classifyWithGeminiText,
  classifyWithGeminiVision,
  getGeminiPromptHash,
  getGeminiPromptVersion,
} from "./geminiClassifier";
import { computeGatekeeperRoute, computeNeedsReviewReasonCode } from "./routing";
import type {
  GatekeeperDocInput,
  GatekeeperResult,
  GatekeeperClassification,
  NeedsReviewReasonCode,
} from "./types";

// ─── Image MIME types we can send directly to vision ────────────────────────

const VISION_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/tiff",
]);

// ─── Main Entry ─────────────────────────────────────────────────────────────

export async function runGatekeeperForDocument(
  input: GatekeeperDocInput,
  options?: { mode?: "inline" | "batch" },
): Promise<GatekeeperResult> {
  const sb = supabaseAdmin();
  const promptHash = getGeminiPromptHash();
  const promptVersion = getGeminiPromptVersion();
  const started = Date.now();
  const mode = options?.mode ?? "inline";

  // ── 1. Idempotency check ──────────────────────────────────────────────
  if (!input.forceReclassify) {
    const { data: existingDoc } = await (sb as any)
      .from("deal_documents")
      .select(
        "gatekeeper_classified_at, gatekeeper_doc_type, gatekeeper_confidence, " +
        "gatekeeper_tax_year, gatekeeper_form_numbers, gatekeeper_route, " +
        "gatekeeper_needs_review, gatekeeper_reasons, gatekeeper_signals, " +
        "gatekeeper_model, gatekeeper_prompt_version, gatekeeper_prompt_hash, " +
        "gatekeeper_review_reason_code"
      )
      .eq("id", input.documentId)
      .maybeSingle();

    if (existingDoc?.gatekeeper_classified_at) {
      return {
        doc_type: existingDoc.gatekeeper_doc_type ?? "UNKNOWN",
        confidence: Number(existingDoc.gatekeeper_confidence ?? 0),
        tax_year: existingDoc.gatekeeper_tax_year ?? null,
        reasons: existingDoc.gatekeeper_reasons ?? [],
        detected_signals: existingDoc.gatekeeper_signals ?? {
          form_numbers: [],
          has_ein: false,
          has_ssn: false,
        },
        route: existingDoc.gatekeeper_route ?? "NEEDS_REVIEW",
        needs_review: existingDoc.gatekeeper_needs_review ?? false,
        reviewReasonCode: (existingDoc.gatekeeper_review_reason_code as NeedsReviewReasonCode) ?? null,
        cache_hit: false,
        model: existingDoc.gatekeeper_model ?? "cached_on_doc",
        prompt_version: existingDoc.gatekeeper_prompt_version ?? promptVersion,
        prompt_hash: existingDoc.gatekeeper_prompt_hash ?? promptHash,
        input_path: "already_classified",
      };
    }
  }

  try {
    // ── 2. Cache check ────────────────────────────────────────────────────
    if (input.sha256) {
      const cached = await readGatekeeperCache(input.bankId, input.sha256, promptHash);
      if (cached) {
        // Defense-in-depth: verify cache row was produced by current prompt
        if (cached.prompt_version !== getGeminiPromptVersion()) {
          console.warn("[Gatekeeper] cache prompt_version drift (hash matched)", {
            documentId: input.documentId,
            cachedVersion: cached.prompt_version,
            currentVersion: getGeminiPromptVersion(),
          });
          // prompt_hash is authoritative — if hash matched, cache is still valid.
        }
        const route = computeGatekeeperRoute(cached.classification);
        const reviewReasonCode = computeNeedsReviewReasonCode(cached.classification, "cache");
        const result: GatekeeperResult = {
          ...cached.classification,
          route,
          needs_review: route === "NEEDS_REVIEW",
          reviewReasonCode,
          cache_hit: true,
          model: cached.model,
          prompt_version: cached.prompt_version,
          prompt_hash: promptHash,
          prompt_tokens: cached.prompt_tokens,
          completion_tokens: cached.completion_tokens,
          latency_ms: Date.now() - started,
          input_path: "cache",
        };
        await stampDocument(sb, input, result);
        await emitLedgerEvents(input, result, mode);
        return result;
      }
    }

    // ── 3. Emit CLASSIFY_REQUESTED event ────────────────────────────────
    writeEvent({
      dealId: input.dealId,
      kind: "DOC_GATEKEEPER_CLASSIFY_REQUESTED",
      input: {
        document_id: input.documentId,
        sha256: input.sha256,
        has_ocr_text: Boolean(input.ocrText && input.ocrText.length > 100),
        mime_type: input.mimeType,
      },
    }).catch(() => {});

    // ── 4. Call Gemini (primary classifier — Phase 24) ─────────────────
    let classification: GatekeeperClassification & {
      model: string;
      prompt_version: string;
      prompt_hash: string;
      prompt_tokens?: number;
      completion_tokens?: number;
    };
    let inputPath: GatekeeperResult["input_path"];

    if (input.ocrText && input.ocrText.length > 100) {
      // Text path (preferred — cheaper, faster)
      const geminiResult = await classifyWithGeminiText(input.ocrText);
      if (!geminiResult) {
        inputPath = "no_ocr_no_image";
        const failResult = buildFailResult(
          promptHash, promptVersion, "no_ocr_no_image",
          "Gemini classifier returned null on text path",
          Date.now() - started,
        );
        await stampDocument(sb, input, failResult);
        await emitLedgerEvents(input, failResult, mode);
        return failResult;
      }
      classification = {
        ...geminiResult,
        prompt_version: promptVersion,
        prompt_hash: promptHash,
      };
      inputPath = "text";
    } else if (VISION_MIME_TYPES.has(input.mimeType.toLowerCase())) {
      // Vision path for image files
      const fileBytes = await downloadFile(sb, input.storageBucket, input.storagePath);
      const visionBase64 = fileBytes.toString("base64");
      const geminiVisionResult = await classifyWithGeminiVision(visionBase64, input.mimeType);
      if (!geminiVisionResult) {
        inputPath = "no_ocr_no_image";
        const failResult = buildFailResult(
          promptHash, promptVersion, "no_ocr_no_image",
          "Gemini classifier returned null on vision path",
          Date.now() - started,
        );
        await stampDocument(sb, input, failResult);
        await emitLedgerEvents(input, failResult, mode);
        return failResult;
      }
      classification = {
        ...geminiVisionResult,
        prompt_version: promptVersion,
        prompt_hash: promptHash,
      };
      inputPath = "vision";
    } else {
      // PDF or other non-image without OCR text — route to NEEDS_REVIEW
      console.warn("[Gatekeeper] No OCR text and non-image file, routing to NEEDS_REVIEW", {
        documentId: input.documentId,
        mimeType: input.mimeType,
      });
      inputPath = "no_ocr_no_image";
      const failResult = buildFailResult(
        promptHash,
        promptVersion,
        inputPath,
        "No OCR text available and file is not a directly-viewable image",
        Date.now() - started,
      );
      await stampDocument(sb, input, failResult);
      await emitLedgerEvents(input, failResult, mode);
      return failResult;
    }

    // ── 5. Apply routing rules ──────────────────────────────────────────
    const route = computeGatekeeperRoute(classification);
    const reviewReasonCode = computeNeedsReviewReasonCode(classification, inputPath);

    const result: GatekeeperResult = {
      ...classification,
      route,
      needs_review: route === "NEEDS_REVIEW",
      reviewReasonCode,
      cache_hit: false,
      input_path: inputPath,
      latency_ms: Date.now() - started,
    };

    // ── 6. Stamp deal_documents ─────────────────────────────────────────
    await stampDocument(sb, input, result);

    // ── 6b. Auto-fill slot (fire-and-forget, non-blocking) ────────────
    if (!result.needs_review) {
      try {
        const { autoMatchDocToSlot } = await import(
          "@/lib/intake/slots/autoMatchDocToSlot"
        );
        await autoMatchDocToSlot({
          dealId: input.dealId,
          bankId: input.bankId,
          documentId: input.documentId,
          gatekeeperDocType: result.doc_type,
          gatekeeperTaxYear: result.tax_year,
        });
      } catch {
        // Non-fatal: slot matching failure never blocks pipeline
      }
    }

    // ── 7. Write cache + ledger ─────────────────────────────────────────
    if (input.sha256) {
      writeGatekeeperCache({
        bankId: input.bankId,
        sha256: input.sha256,
        promptHash,
        resultJson: {
          doc_type: classification.doc_type,
          confidence: classification.confidence,
          tax_year: classification.tax_year,
          reasons: classification.reasons,
          detected_signals: classification.detected_signals,
        },
        model: classification.model,
        promptVersion: classification.prompt_version,
        promptTokens: undefined,
        completionTokens: undefined,
      }).catch(() => {});
    }

    await emitLedgerEvents(input, result, mode);
    return result;
  } catch (error: any) {
    // ── FAIL-CLOSED: errors → NEEDS_REVIEW ──────────────────────────────
    console.error("[Gatekeeper] Classification failed, routing to NEEDS_REVIEW", {
      documentId: input.documentId,
      error: error?.message,
    });

    const failResult = buildFailResult(
      promptHash,
      promptVersion,
      "error",
      error?.message ?? "unknown error",
      Date.now() - started,
    );

    await stampDocument(sb, input, failResult).catch(() => {});
    await emitLedgerEvents(input, failResult, mode).catch(() => {});

    return failResult;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildFailResult(
  promptHash: string,
  promptVersion: string,
  inputPath: GatekeeperResult["input_path"],
  errorMessage: string,
  latencyMs: number,
): GatekeeperResult {
  const failClassification = { doc_type: "UNKNOWN" as const, confidence: 0, tax_year: null };
  return {
    ...failClassification,
    reasons: [errorMessage],
    detected_signals: { form_numbers: [], has_ein: false, has_ssn: false },
    route: "NEEDS_REVIEW",
    needs_review: true,
    reviewReasonCode: computeNeedsReviewReasonCode(failClassification, inputPath),
    cache_hit: false,
    model: "error",
    prompt_version: promptVersion,
    prompt_hash: promptHash,
    input_path: inputPath,
    latency_ms: latencyMs,
  };
}

async function downloadFile(
  sb: ReturnType<typeof supabaseAdmin>,
  bucket: string,
  path: string,
): Promise<Buffer> {
  const dl = await sb.storage.from(bucket).download(path);
  if (dl.error) throw new Error(`storage_download_failed: ${dl.error.message}`);
  return Buffer.from(await dl.data.arrayBuffer());
}

async function stampDocument(
  sb: ReturnType<typeof supabaseAdmin>,
  input: GatekeeperDocInput,
  result: GatekeeperResult,
): Promise<void> {
  try {
    const { error } = await (sb as any)
      .from("deal_documents")
      .update({
        gatekeeper_doc_type: result.doc_type,
        gatekeeper_confidence: result.confidence,
        gatekeeper_tax_year: result.tax_year,
        gatekeeper_form_numbers: result.detected_signals.form_numbers,
        gatekeeper_route: result.route,
        gatekeeper_needs_review: result.needs_review,
        gatekeeper_review_reason_code: result.reviewReasonCode ?? null,
        gatekeeper_reasons: result.reasons,
        gatekeeper_signals: result.detected_signals,
        gatekeeper_model: result.model,
        gatekeeper_prompt_version: result.prompt_version,
        gatekeeper_prompt_hash: result.prompt_hash,
        gatekeeper_classified_at: new Date().toISOString(),
        gatekeeper_error:
          result.input_path === "error" || result.input_path === "no_ocr_no_image"
            ? result.reasons[0] ?? null
            : null,
      })
      .eq("id", input.documentId);

    if (error) {
      // Supabase returns CHECK / RLS / permission errors in-band on the response
      // object rather than throwing. Without this check, constraint violations
      // are silently discarded and callers think the write succeeded — bug
      // discovered during Phase 84 T-02 when PERSONAL_FINANCIAL_STATEMENT
      // classifications were silently failing the gatekeeper_doc_type CHECK.
      console.error("[Gatekeeper] stampDocument write failed", {
        documentId: input.documentId,
        docType: result.doc_type,
        errorCode: (error as any).code,
        errorMessage: (error as any).message,
        errorHint: (error as any).hint,
      });
      throw new Error(
        `stampDocument failed for ${input.documentId}: ${(error as any).code} ${(error as any).message}`,
      );
    }

    // ── Spec D1 — persist entity names into the ai_* columns that the
    // naming engine reads from. Two separate conditional writes so we
    // only populate a column if it is currently null; this coexists with
    // downstream writers (processArtifact, persistAiMapping) rather than
    // racing with them. Non-fatal: a failure here does not fail the
    // gatekeeper stamp above.
    await stampEntityNames(sb, input, result).catch((e) => {
      console.warn("[Gatekeeper] stampEntityNames failed (non-fatal)", {
        documentId: input.documentId,
        error: String((e as any)?.message ?? e),
      });
    });
  } catch (e) {
    console.error("[Gatekeeper] stampDocument failed", {
      documentId: input.documentId,
      error: String((e as any)?.message ?? e),
    });
    throw e;
  }
}

/**
 * Spec D1 — write classifier-extracted entity names into deal_documents.
 * Each column is guarded by .is("<col>", null) so an existing value from a
 * downstream writer (processArtifact.ts, persistAiMapping.ts) is preserved.
 *
 * When Gemini returned a name but the conditional update affects zero rows,
 * something already wrote to the column — logged as telemetry so we can
 * decide later whether to fix the upstream clobber at processArtifact.ts.
 */
async function stampEntityNames(
  sb: ReturnType<typeof supabaseAdmin>,
  input: GatekeeperDocInput,
  result: GatekeeperResult,
): Promise<void> {
  const businessName = result.detected_signals.business_name ?? null;
  const borrowerName = result.detected_signals.borrower_name ?? null;

  if (businessName) {
    const { error, count } = await (sb as any)
      .from("deal_documents")
      .update(
        { ai_business_name: businessName },
        { count: "exact" },
      )
      .eq("id", input.documentId)
      .is("ai_business_name", null);

    if (!error && count === 0) {
      console.info("[Gatekeeper] ai_business_name already populated, skipping", {
        documentId: input.documentId,
      });
    } else if (error) {
      console.warn("[Gatekeeper] ai_business_name update failed", {
        documentId: input.documentId,
        errorCode: (error as any).code,
        errorMessage: (error as any).message,
      });
    }
  }

  if (borrowerName) {
    const { error, count } = await (sb as any)
      .from("deal_documents")
      .update(
        { ai_borrower_name: borrowerName },
        { count: "exact" },
      )
      .eq("id", input.documentId)
      .is("ai_borrower_name", null);

    if (!error && count === 0) {
      console.info("[Gatekeeper] ai_borrower_name already populated, skipping", {
        documentId: input.documentId,
      });
    } else if (error) {
      console.warn("[Gatekeeper] ai_borrower_name update failed", {
        documentId: input.documentId,
        errorCode: (error as any).code,
        errorMessage: (error as any).message,
      });
    }
  }
}

async function emitLedgerEvents(
  input: GatekeeperDocInput,
  result: GatekeeperResult,
  mode: "inline" | "batch" = "inline",
): Promise<void> {
  const basePayload = {
    document_id: input.documentId,
    sha256: input.sha256,
    doc_type: result.doc_type,
    confidence: result.confidence,
    tax_year: result.tax_year,
    route: result.route,
    needs_review: result.needs_review,
    review_reason_code: result.reviewReasonCode ?? null,
    cache_hit: result.cache_hit,
    input_path: result.input_path,
    stamp_mode: mode,
    model: result.model,
    prompt_version: result.prompt_version,
    prompt_hash: result.prompt_hash,
    latency_ms: result.latency_ms,
    prompt_tokens: result.prompt_tokens,
    completion_tokens: result.completion_tokens,
    form_numbers: result.detected_signals.form_numbers,
    reasons: result.reasons,
  };

  // Classified or Failed event
  const isError = result.input_path === "error" || result.input_path === "no_ocr_no_image";
  const classifyEvent = isError
    ? "DOC_GATEKEEPER_CLASSIFY_FAILED"
    : "DOC_GATEKEEPER_CLASSIFIED";

  writeEvent({
    dealId: input.dealId,
    kind: classifyEvent,
    input: basePayload,
  }).catch(() => {});

  // Routing event
  const routeEvent =
    result.route === "GOOGLE_DOC_AI_CORE"
      ? "DOC_ROUTED_TO_GOOGLE_DOCAI"
      : result.route === "STANDARD"
        ? "DOC_ROUTED_TO_STANDARD"
        : "DOC_ROUTED_TO_REVIEW";

  writeEvent({
    dealId: input.dealId,
    kind: routeEvent,
    input: basePayload,
  }).catch(() => {});

  // Pipeline ledger
  logLedgerEvent({
    dealId: input.dealId,
    bankId: input.bankId,
    eventKey: `gatekeeper.${result.route === "NEEDS_REVIEW" ? "needs_review" : "classified"}.${mode}`,
    uiState: result.route === "NEEDS_REVIEW" ? "waiting" : "done",
    uiMessage:
      result.route === "NEEDS_REVIEW"
        ? `Document needs review (${result.doc_type}, conf=${result.confidence.toFixed(2)})`
        : `Gatekeeper: ${result.doc_type} → ${result.route}`,
    meta: basePayload,
  }).catch(() => {});
}
