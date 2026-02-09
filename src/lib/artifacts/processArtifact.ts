/**
 * Process a document artifact through the Magic Intake pipeline.
 *
 * Steps:
 * 1. Fetch document metadata from source table
 * 2. Get document text (from OCR results OR trigger OCR if missing)
 * 3. Classify document type using AI
 * 4. Match to checklist items
 * 5. Update artifact and create matches
 * 6. Stamp deal_documents with classification
 * 7. Reconcile checklist and recompute readiness
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  classifyDocument,
  mapDocTypeToChecklistKeys,
  type ClassificationResult,
} from "./classifyDocument";
import { resolveDocTyping } from "@/lib/docs/typing/resolveDocTyping";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { emitPipelineEvent } from "@/lib/pulseMcp/emitPipelineEvent";
import { writeEvent } from "@/lib/ledger/writeEvent";

export type ProcessArtifactResult = {
  ok: boolean;
  artifactId: string;
  classification?: ClassificationResult;
  matchedKeys?: string[];
  error?: string;
  ocrTriggered?: boolean;
  skipped?: boolean;
  skipReason?: string;
};

type ArtifactRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  source_table: "deal_documents" | "borrower_uploads";
  source_id: string;
  retry_count: number;
};

type OcrResult =
  | { ok: true; text: string }
  | { ok: false; code: "ocr_disabled" | "download_failed" | "ocr_error"; message: string };

/**
 * Run OCR directly on a document (bypasses document_jobs lookup).
 * This is a streamlined version for the artifact processor.
 * Returns a structured result — never bare null.
 */
async function runOcrForDocument(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  documentId: string,
  storageBucket: string,
  storagePath: string,
  originalFilename: string,
  mimeType: string | null,
  bankId: string,
): Promise<OcrResult> {
  // Check if Gemini OCR is enabled
  if (process.env.USE_GEMINI_OCR !== "true") {
    return { ok: false, code: "ocr_disabled", message: "USE_GEMINI_OCR is not enabled" };
  }

  try {
    // 1. Download file from storage
    const dl = await sb.storage.from(storageBucket).download(storagePath);
    if (dl.error) {
      console.error("[processArtifact] Failed to download file for OCR", {
        storageBucket,
        storagePath,
        error: dl.error.message,
      });
      return { ok: false, code: "download_failed", message: dl.error.message };
    }

    const fileBytes = Buffer.from(await dl.data.arrayBuffer());

    // ── Content hash gate: SHA-256 + virus cache + OCR dedup ──────────
    const { checkContentHash } = await import("@/lib/dedupe/contentHashGate");
    const hashResult = await checkContentHash({
      sb,
      fileBytes,
      bankId,
      dealId,
      documentId,
    });

    // Virus gate: block processing if file is known-infected
    if (hashResult.virusStatus === "infected") {
      console.error("[processArtifact] BLOCKED: file is infected", {
        documentId,
        sha256: hashResult.sha256Hex,
        signature: hashResult.virusSignature,
      });
      return {
        ok: false,
        code: "ocr_error",
        message: `File blocked: virus detected (${hashResult.virusSignature})`,
      };
    }

    // OCR dedup gate: if identical content already has OCR results, reuse them
    if (hashResult.ocrCacheHit && hashResult.ocrText) {
      console.log("[processArtifact] OCR cache hit — reusing existing OCR", {
        documentId,
        donorDocId: hashResult.ocrDonorDocId,
        sha256: hashResult.sha256Hex,
        textLength: hashResult.ocrText.length,
      });

      // Save the reused OCR results for THIS document
      const nowIso = new Date().toISOString();
      await sb.from("document_ocr_results").upsert(
        {
          deal_id: dealId,
          attachment_id: documentId,
          provider: "sha256_dedup",
          status: "SUCCEEDED",
          raw_json: {
            dedup: true,
            donor_doc_id: hashResult.ocrDonorDocId,
            sha256: hashResult.sha256Hex,
          },
          extracted_text: hashResult.ocrText,
          tables_json: null,
          error: null,
          updated_at: nowIso,
        },
        { onConflict: "attachment_id" },
      );

      return { ok: true, text: hashResult.ocrText };
    }
    // ── End content hash gate ─────────────────────────────────────────

    // 2. Infer mime type if not provided
    const inferredMimeType = mimeType || inferMimeTypeFromFilename(originalFilename);

    // 3. Call Gemini OCR
    const { runGeminiOcrJob } = await import("@/lib/ocr/runGeminiOcrJob");

    console.log("[processArtifact] Running Gemini OCR", {
      dealId,
      documentId,
      filename: originalFilename,
      mimeType: inferredMimeType,
      fileSize: fileBytes.length,
    });

    const ocrResult = await runGeminiOcrJob({
      fileBytes,
      mimeType: inferredMimeType,
      fileName: originalFilename,
    });

    // 4. Save OCR results to database
    const nowIso = new Date().toISOString();
    const { error: upsertError } = await sb.from("document_ocr_results").upsert(
      {
        deal_id: dealId,
        attachment_id: documentId,
        provider: "gemini_google",
        status: "SUCCEEDED",
        raw_json: {
          model: ocrResult.model,
          pageCount: ocrResult.pageCount,
        },
        extracted_text: ocrResult.text,
        tables_json: null,
        error: null,
        updated_at: nowIso,
      },
      { onConflict: "attachment_id" },
    );

    if (upsertError) {
      console.error("[processArtifact] Failed to save OCR results", {
        documentId,
        error: upsertError.message,
      });
      // Non-fatal - we still have the text
    }

    console.log("[processArtifact] OCR completed successfully", {
      documentId,
      textLength: ocrResult.text.length,
      pageCount: ocrResult.pageCount,
      model: ocrResult.model,
    });

    return { ok: true, text: ocrResult.text };

  } catch (err: any) {
    console.error("[processArtifact] OCR failed", {
      documentId,
      error: err?.message,
    });
    return { ok: false, code: "ocr_error", message: err?.message || "Unknown OCR error" };
  }
}

/**
 * Infer MIME type from filename extension.
 */
function inferMimeTypeFromFilename(filename: string): string {
  const ext = (filename || "").toLowerCase().split(".").pop() || "";
  switch (ext) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "tif":
    case "tiff": return "image/tiff";
    default: return "application/pdf";
  }
}

/**
 * Get document text for classification.
 * 1. First tries existing OCR results
 * 2. If none, triggers Gemini OCR inline
 * 3. Falls back to filename-only as last resort
 */
async function getDocumentText(
  sb: ReturnType<typeof supabaseAdmin>,
  sourceTable: string,
  sourceId: string,
  dealId: string,
  bankId: string,
): Promise<{ text: string; filename: string; mimeType: string | null; ocrTriggered: boolean }> {
  // Get the source document metadata
  let doc: {
    original_filename: string;
    mime_type: string | null;
    storage_path: string;
    storage_bucket: string | null;
  } | null = null;

  if (sourceTable === "deal_documents") {
    const { data } = await sb
      .from("deal_documents")
      .select("original_filename, mime_type, storage_path, storage_bucket")
      .eq("id", sourceId)
      .maybeSingle();
    doc = data;
  } else if (sourceTable === "borrower_uploads") {
    const { data } = await sb
      .from("borrower_uploads")
      .select("original_filename, mime_type, storage_path, storage_bucket")
      .eq("id", sourceId)
      .maybeSingle();
    doc = data;
  }

  if (!doc) {
    throw new Error(`Document not found: ${sourceTable}/${sourceId}`);
  }

  // Try to get existing OCR text from document_ocr_results
  const { data: ocrData } = await sb
    .from("document_ocr_results")
    .select("extracted_text")
    .eq("deal_id", dealId)
    .eq("attachment_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ocrData?.extracted_text) {
    console.log("[processArtifact] Found existing OCR text", {
      sourceId,
      textLength: ocrData.extracted_text.length,
    });
    return {
      text: ocrData.extracted_text,
      filename: doc.original_filename,
      mimeType: doc.mime_type,
      ocrTriggered: false,
    };
  }

  // Try deal_doc_chunks (legacy)
  const { data: chunks } = await sb
    .from("deal_doc_chunks")
    .select("content")
    .eq("deal_id", dealId)
    .eq("storage_path", doc.storage_path)
    .order("chunk_index", { ascending: true })
    .limit(20);

  if (chunks && chunks.length > 0) {
    const combinedText = chunks.map((c) => c.content).join("\n\n");
    return {
      text: combinedText,
      filename: doc.original_filename,
      mimeType: doc.mime_type,
      ocrTriggered: false,
    };
  }

  // =========================================================================
  // NO OCR EXISTS - TRIGGER GEMINI OCR INLINE
  // =========================================================================
  console.log("[processArtifact] No OCR text found, triggering Gemini OCR", {
    sourceTable,
    sourceId,
    filename: doc.original_filename,
    storagePath: doc.storage_path,
  });

  // Log OCR start
  await logLedgerEvent({
    dealId,
    bankId,
    eventKey: "ocr.triggered",
    uiState: "working",
    uiMessage: `Running OCR on ${doc.original_filename}`,
    meta: {
      source_id: sourceId,
      source_table: sourceTable,
      filename: doc.original_filename,
    },
  });

  const storageBucket = doc.storage_bucket || "deal-files";
  const ocrResult = await runOcrForDocument(
    sb,
    dealId,
    sourceId,
    storageBucket,
    doc.storage_path,
    doc.original_filename,
    doc.mime_type,
    bankId,
  );

  if (ocrResult.ok) {
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "ocr.completed",
      uiState: "done",
      uiMessage: `OCR completed for ${doc.original_filename}`,
      meta: {
        source_id: sourceId,
        text_length: ocrResult.text.length,
      },
    });

    return {
      text: ocrResult.text,
      filename: doc.original_filename,
      mimeType: doc.mime_type,
      ocrTriggered: true,
    };
  }

  // OCR failed or not enabled - fall back to filename-only
  const ocrSkipReason = ocrResult.code;

  await logLedgerEvent({
    dealId,
    bankId,
    eventKey: "ocr.skipped",
    uiState: "done",
    uiMessage: `OCR skipped for ${doc.original_filename} (using filename only)`,
    meta: {
      source_id: sourceId,
      reason: ocrSkipReason,
    },
  });

  // Canonical deal_events ledger (Section A: dual-ledger visibility)
  void writeEvent({
    dealId,
    kind: "ocr.skipped",
    scope: "artifact",
    action: "ocr_skip",
    meta: {
      source_id: sourceId,
      source_table: sourceTable,
      filename: doc.original_filename,
      reason: ocrSkipReason,
      ocr_message: ocrResult.message,
    },
  });

  console.warn("[processArtifact] Using filename-only classification (low confidence)", {
    sourceTable,
    sourceId,
    filename: doc.original_filename,
    reason: ocrSkipReason,
  });

  return {
    text: `[No OCR text available. Classify based on filename: ${doc.original_filename}]`,
    filename: doc.original_filename,
    mimeType: doc.mime_type,
    ocrTriggered: false,
  };
}

/**
 * Find matching checklist items for the classified document.
 */
async function findMatchingChecklistItems(
  sb: ReturnType<typeof supabaseAdmin>,
  dealId: string,
  possibleKeys: string[]
): Promise<Array<{ id: string; checklist_key: string }>> {
  if (possibleKeys.length === 0) return [];

  const { data: items } = await sb
    .from("deal_checklist_items")
    .select("id, checklist_key")
    .eq("deal_id", dealId)
    .in("checklist_key", possibleKeys);

  return items || [];
}

/**
 * Check if a document has been manually classified by a banker.
 * If match_source = "manual", AI must NEVER overwrite.
 */
async function checkManualOverride(
  sb: ReturnType<typeof supabaseAdmin>,
  sourceTable: string,
  sourceId: string,
): Promise<{
  isManual: boolean;
  checklistKey: string | null;
  documentType: string | null;
}> {
  if (sourceTable !== "deal_documents") {
    return { isManual: false, checklistKey: null, documentType: null };
  }

  const { data } = await sb
    .from("deal_documents")
    .select("match_source, checklist_key, document_type")
    .eq("id", sourceId)
    .maybeSingle();

  if (data?.match_source === "manual") {
    return {
      isManual: true,
      checklistKey: data.checklist_key,
      documentType: data.document_type,
    };
  }

  return { isManual: false, checklistKey: null, documentType: null };
}

/**
 * Process a single artifact through the classification pipeline.
 */
export async function processArtifact(
  artifact: ArtifactRow
): Promise<ProcessArtifactResult> {
  const sb = supabaseAdmin();
  const { id: artifactId, deal_id: dealId, bank_id: bankId, source_table, source_id } = artifact;

  try {
    const startedAt = Date.now();

    // Lifecycle: artifact processing started
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "artifact.processing.started",
      uiState: "working",
      uiMessage: "Processing document...",
      meta: {
        artifact_id: artifactId,
        source_table,
        source_id,
        retry_count: artifact.retry_count,
      },
    });

    // STEP 0: Check for manual override — banker's word is final
    const manualCheck = await checkManualOverride(sb, source_table, source_id);

    if (manualCheck.isManual) {
      console.log("[processArtifact] MANUAL OVERRIDE - Skipping AI classification", {
        artifactId,
        sourceId: source_id,
        checklistKey: manualCheck.checklistKey,
      });

      // Update artifact status to reflect it's been handled
      await sb
        .from("document_artifacts")
        .update({
          status: "matched",
          doc_type_confidence: 1.0,
          doc_type_reason: "Manual classification by banker (preserved)",
          match_confidence: 1.0,
          match_reason: "Manual override - AI classification skipped",
        } as any)
        .eq("id", artifactId);

      // Finalize the deal_document — manual override means "done"
      if (source_table === "deal_documents") {
        await sb
          .from("deal_documents")
          .update({ finalized_at: new Date().toISOString() } as any)
          .eq("id", source_id)
          .is("finalized_at", null);
      }

      await logLedgerEvent({
        dealId,
        bankId,
        eventKey: "artifact.skipped_manual",
        uiState: "done",
        uiMessage: "Skipped AI classification (banker override)",
        meta: {
          artifact_id: artifactId,
          source_id,
          manual_checklist_key: manualCheck.checklistKey,
          reason: "match_source=manual",
        },
      });

      return {
        ok: true,
        artifactId,
        skipped: true,
        skipReason: "manual_override",
      };
    }

    // 1. Get document text (triggers OCR if needed)
    const { text, filename, mimeType, ocrTriggered } = await getDocumentText(
      sb,
      source_table,
      source_id,
      dealId,
      bankId
    );

    // 2. Classify the document
    const classification = await classifyDocument(text, filename, mimeType);

    // 2.5. Resolve canonical typing with form-number guardrails
    const typingResult = resolveDocTyping({
      aiDocType: classification.docType,
      aiFormNumbers: classification.formNumbers,
      aiConfidence: classification.confidence,
      aiTaxYear: classification.taxYear,
      aiEntityType: classification.entityType,
    });

    if (typingResult.guardrail_applied) {
      console.warn("[processArtifact] Form-number guardrail applied", {
        source_id,
        originalDocType: classification.docType,
        overriddenTo: typingResult.effective_doc_type,
        reason: typingResult.guardrail_reason,
      });
    }

    // 3. Update artifact with classification
    await sb.rpc("update_artifact_classification", {
      p_artifact_id: artifactId,
      p_doc_type: typingResult.effective_doc_type,
      p_doc_type_confidence: classification.confidence,
      p_doc_type_reason: classification.reason,
      p_tax_year: classification.taxYear,
      p_entity_name: classification.entityName,
      p_entity_type: classification.entityType,
      p_extraction_json: classification.rawExtraction,
      p_proposed_deal_name: classification.proposedDealName,
      p_proposed_deal_name_source: classification.proposedDealNameSource,
    });

    // 4. Find matching checklist keys (use effective docType after guardrails)
    const possibleKeys = mapDocTypeToChecklistKeys(
      typingResult.effective_doc_type as any,
      classification.taxYear
    );

    const matchingItems = await findMatchingChecklistItems(sb, dealId, possibleKeys);
    const matchedKeys: string[] = [];

    // 5. Create matches for each matching checklist item
    for (const item of matchingItems) {
      const matchResult = await sb.rpc("create_checklist_match", {
        p_deal_id: dealId,
        p_bank_id: bankId,
        p_artifact_id: artifactId,
        p_checklist_key: item.checklist_key,
        p_confidence: classification.confidence,
        p_reason: classification.reason,
        p_match_source: "ai_classification",
        p_tax_year: classification.taxYear,
        p_auto_apply: classification.confidence >= 0.85,
      });

      if (!matchResult.error) {
        matchedKeys.push(item.checklist_key);
      }
    }

    // 6. If we matched at least one, update artifact as matched
    if (matchedKeys.length > 0) {
      await sb.rpc("update_artifact_matched", {
        p_artifact_id: artifactId,
        p_matched_checklist_key: matchedKeys[0],
        p_match_confidence: classification.confidence,
        p_match_reason: `Matched to ${matchedKeys.length} checklist item(s)`,
      });
    }

    // 6.5. STAMP deal_documents with authoritative classification (all 24 fields)
    // Double-check manual status first (race condition protection)
    if (source_table === "deal_documents") {
      const recheckManual = await sb
        .from("deal_documents")
        .select("match_source")
        .eq("id", source_id)
        .maybeSingle();

      if (recheckManual.data?.match_source === "manual") {
        console.log("[processArtifact] Manual override detected during stamp - skipping", {
          source_id,
        });
      } else {
        const docYears = classification.taxYear ? [classification.taxYear] : null;

        // Route entity name to schema-real columns based on canonical type.
        const entityName = classification.entityName ?? null;
        const entityPatch: Record<string, any> = {};
        if (entityName) {
          if (typingResult.document_type === "BUSINESS_TAX_RETURN") entityPatch.ai_business_name = entityName;
          if (typingResult.document_type === "PERSONAL_TAX_RETURN" || typingResult.document_type === "PFS") entityPatch.ai_borrower_name = entityName;
        }

        const stampResult = await sb
          .from("deal_documents")
          .update({
            // Existing fields
            document_type: typingResult.document_type,
            doc_year: classification.taxYear ?? null,
            doc_years: docYears,
            checklist_key: typingResult.checklist_key,
            match_source: "ai_classification",
            match_confidence: classification.confidence,
            match_reason: classification.reason,
            finalized_at: new Date().toISOString(),
            // Raw AI classification fields
            ai_doc_type: classification.docType,
            ai_confidence: classification.confidence,
            ai_model: "claude-sonnet-4-5-20250929",
            ai_reason: classification.reason,
            ai_form_numbers: classification.formNumbers,
            ai_issuer: classification.issuer,
            ai_tax_year: classification.taxYear,
            ai_period_start: classification.periodStart,
            ai_period_end: classification.periodEnd,
            ai_extracted_json: classification.rawExtraction,
            // Resolved typing fields
            canonical_type: typingResult.canonical_type,
            routing_class: typingResult.routing_class,
            classification_confidence: classification.confidence,
            classification_reason: typingResult.guardrail_applied
              ? `${classification.reason} [guardrail: ${typingResult.guardrail_reason}]`
              : classification.reason,
            // Entity routing
            ...entityPatch,
          } as any)
          .eq("id", source_id)
          .select("id, checklist_key, match_source, document_type, doc_year, ai_business_name, ai_borrower_name, canonical_type, routing_class")
          .maybeSingle();

        if (stampResult.error) {
          console.error("[processArtifact] STAMP FAILED", {
            source_id,
            error: stampResult.error.message,
            code: stampResult.error.code,
            details: stampResult.error.details,
          });

          // Mark artifact as failed — stamp failure is NOT recoverable silently
          await sb
            .from("document_artifacts")
            .update({
              status: "failed",
              match_reason: `stamp_failed: ${stampResult.error.message}`,
            } as any)
            .eq("id", artifactId);

          // Loud ledger event for observability
          await logLedgerEvent({
            dealId,
            bankId,
            eventKey: "artifact.stamp_failed",
            uiState: "error",
            uiMessage: "Failed to stamp deal_documents (schema mismatch or RLS)",
            meta: {
              artifact_id: artifactId,
              source_id,
              error: {
                message: stampResult.error.message,
                code: stampResult.error.code,
                details: stampResult.error.details,
              },
              attempted: {
                canonical_type: typingResult.canonical_type,
                checklist_key: typingResult.checklist_key,
                taxYear: classification.taxYear ?? null,
                guardrail: typingResult.guardrail_applied ? typingResult.guardrail_reason : null,
                entityPatch,
              },
            },
          });

          return { ok: false, artifactId, error: "stamp_failed" };
        } else if (!stampResult.data) {
          console.error("[processArtifact] STAMP NO ROWS UPDATED", {
            source_id,
            canonical_type: typingResult.canonical_type,
            checklist_key: typingResult.checklist_key,
          });
        } else {
          console.log("[processArtifact] Stamp successful", {
            source_id,
            checklist_key: stampResult.data.checklist_key,
            match_source: stampResult.data.match_source,
            canonical_type: stampResult.data.canonical_type,
            routing_class: stampResult.data.routing_class,
          });
        }
      }
    }

    // 6.5b. Materialize anchoring facts for financial documents (breaks NO_FACTS deadlock)
    try {
      const { materializeFactsFromArtifacts } = await import(
        "@/lib/financialFacts/materializeFactsFromArtifacts"
      );
      const matResult = await materializeFactsFromArtifacts({ dealId, bankId });
      if (!matResult.ok) {
        console.warn("[processArtifact] materializeFactsFromArtifacts failed", {
          dealId,
          bankId,
          error: (matResult as any).error,
        });
      } else if (matResult.factsWritten > 0) {
        await logLedgerEvent({
          dealId,
          bankId,
          eventKey: "facts.materialization.from_docs.completed",
          uiState: "done",
          uiMessage: `${matResult.factsWritten} anchor fact(s) materialized from classified documents`,
          meta: {
            factsWritten: matResult.factsWritten,
            docsConsidered: matResult.docsConsidered,
            trigger: "artifact_processor",
          },
        });
      }
    } catch (matErr: any) {
      console.warn("[processArtifact] materializeFactsFromArtifacts threw", {
        dealId,
        error: matErr?.message,
      });
    }

    // 6.6. Reconcile checklist (flips required items to received)
    const { reconcileChecklistForDeal } = await import(
      "@/lib/checklist/engine"
    );
    await reconcileChecklistForDeal({ sb, dealId });

    // 6.6b. Ensure deal_status exists (self-heal before readiness/naming)
    try {
      const { bootstrapDealLifecycle } = await import(
        "@/lib/lifecycle/bootstrapDealLifecycle"
      );
      await bootstrapDealLifecycle(dealId);
    } catch {
      // Non-fatal
    }

    // 6.7. Recompute deal readiness (non-fatal: must not block naming derivation)
    try {
      const { recomputeDealReady } = await import("@/lib/deals/readiness");
      await recomputeDealReady(dealId);
    } catch (readinessErr: any) {
      console.warn("[processArtifact] readiness recompute failed (non-fatal)", {
        dealId,
        source_id,
        error: readinessErr?.message,
      });
    }

    // 6.8. Two-phase naming: single entry point for document + deal naming
    try {
      const { runNamingDerivation } = await import("@/lib/naming/runNamingDerivation");
      await runNamingDerivation({ dealId, bankId, documentId: source_id });
    } catch (namingErr: any) {
      console.warn("[processArtifact] naming derivation failed (non-fatal)", {
        dealId,
        source_id,
        error: namingErr?.message,
      });
    }

    // 7. Log success
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "artifact.processed",
      uiState: "done",
      uiMessage: `Document classified as ${classification.docType}${ocrTriggered ? " (OCR triggered)" : ""}`,
      meta: {
        artifact_id: artifactId,
        doc_type: classification.docType,
        confidence: classification.confidence,
        tax_year: classification.taxYear,
        matched_keys: matchedKeys,
        stamped: source_table === "deal_documents",
        ocr_triggered: ocrTriggered,
      },
    });

    // Lifecycle: artifact processing completed
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "artifact.processing.completed",
      uiState: "done",
      uiMessage: `Document processing completed (${classification.docType})`,
      meta: {
        artifact_id: artifactId,
        doc_type: classification.docType,
        confidence: classification.confidence,
        matched_keys: matchedKeys,
        duration_ms: Date.now() - startedAt,
      },
    });

    // Pulse: artifact processed
    void emitPipelineEvent({
      kind: "artifact_processed",
      deal_id: dealId,
      bank_id: bankId,
      payload: {
        artifact_id: artifactId,
        document_type: classification.docType,
        confidence: classification.confidence,
        checklist_key: matchedKeys?.[0] ?? null,
      },
    });

    return {
      ok: true,
      artifactId,
      classification,
      matchedKeys,
      ocrTriggered,
    };
  } catch (error: any) {
    console.error("[processArtifact] failed", {
      artifactId,
      error: error?.message,
    });

    // Mark as failed
    await sb.rpc("mark_artifact_failed", {
      p_artifact_id: artifactId,
      p_error_message: error?.message || "Unknown error",
    });

    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "artifact.failed",
      uiState: "done",
      uiMessage: "Document classification failed",
      meta: {
        artifact_id: artifactId,
        error: error?.message,
      },
    });

    // Lifecycle: artifact processing failed
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "artifact.processing.failed",
      uiState: "done",
      uiMessage: "Document processing failed",
      meta: {
        artifact_id: artifactId,
        error: error?.message,
        retry_count: artifact.retry_count,
      },
    });

    return {
      ok: false,
      artifactId,
      error: error?.message,
    };
  }
}

/**
 * Process the next queued artifact.
 * Returns null if no artifacts are queued.
 */
export async function processNextArtifact(): Promise<ProcessArtifactResult | null> {
  const sb = supabaseAdmin();

  // Claim the next artifact
  const { data: artifacts, error } = await sb.rpc("claim_next_artifact_for_processing");

  if (error) {
    console.error("[processNextArtifact] claim failed", error);
    return null;
  }

  if (!artifacts || (Array.isArray(artifacts) && artifacts.length === 0)) {
    return null; // No artifacts to process
  }

  const artifact = Array.isArray(artifacts) ? artifacts[0] : artifacts;
  return processArtifact(artifact as ArtifactRow);
}

/**
 * Process multiple artifacts (batch processing).
 * Useful for background job that runs periodically.
 */
export async function processBatch(
  maxItems: number = 10
): Promise<ProcessArtifactResult[]> {
  const results: ProcessArtifactResult[] = [];

  for (let i = 0; i < maxItems; i++) {
    const result = await processNextArtifact();
    if (!result) break; // No more artifacts
    results.push(result);
  }

  return results;
}
