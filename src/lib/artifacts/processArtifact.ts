/**
 * Process a document artifact through the Magic Intake pipeline.
 *
 * Steps:
 * 1. Fetch document metadata from source table
 * 2. Get document text (from OCR results or fetch fresh)
 * 3. Classify document type using AI
 * 4. Match to checklist items
 * 5. Update artifact and create matches
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  classifyDocument,
  mapDocTypeToChecklistKeys,
  type ClassificationResult,
} from "./classifyDocument";
import { normalizeToCanonical } from "@/lib/documents/normalizeType";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export type ProcessArtifactResult = {
  ok: boolean;
  artifactId: string;
  classification?: ClassificationResult;
  matchedKeys?: string[];
  error?: string;
};

type ArtifactRow = {
  id: string;
  deal_id: string;
  bank_id: string;
  source_table: "deal_documents" | "borrower_uploads";
  source_id: string;
  retry_count: number;
};

/**
 * Get document text for classification.
 * First tries OCR results, then falls back to filename-based heuristics.
 */
async function getDocumentText(
  sb: ReturnType<typeof supabaseAdmin>,
  sourceTable: string,
  sourceId: string,
  dealId: string,
): Promise<{ text: string; filename: string; mimeType: string | null }> {
  // Get the source document metadata
  let doc: {
    original_filename: string;
    mime_type: string | null;
    storage_path: string;
  } | null = null;

  if (sourceTable === "deal_documents") {
    const { data } = await sb
      .from("deal_documents")
      .select("original_filename, mime_type, storage_path")
      .eq("id", sourceId)
      .maybeSingle();
    doc = data;
  } else if (sourceTable === "borrower_uploads") {
    const { data } = await sb
      .from("borrower_uploads")
      .select("original_filename, mime_type, storage_path")
      .eq("id", sourceId)
      .maybeSingle();
    doc = data;
  }

  if (!doc) {
    throw new Error(`Document not found: ${sourceTable}/${sourceId}`);
  }

  // Try to get OCR text from document_ocr_results (join by attachment_id = document ID)
  const { data: ocrData } = await sb
    .from("document_ocr_results")
    .select("extracted_text")
    .eq("deal_id", dealId)
    .eq("attachment_id", sourceId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ocrData?.extracted_text) {
    return {
      text: ocrData.extracted_text,
      filename: doc.original_filename,
      mimeType: doc.mime_type,
    };
  }

  // Try deal_doc_chunks
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
    };
  }

  // Fall back to filename-only classification
  console.warn("[processArtifact] No OCR text found, using filename only", {
    sourceTable,
    sourceId,
    filename: doc.original_filename,
  });

  return {
    text: `[No OCR text available. Classify based on filename: ${doc.original_filename}]`,
    filename: doc.original_filename,
    mimeType: doc.mime_type,
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
 * Process a single artifact through the classification pipeline.
 */
export async function processArtifact(
  artifact: ArtifactRow
): Promise<ProcessArtifactResult> {
  const sb = supabaseAdmin();
  const { id: artifactId, deal_id: dealId, bank_id: bankId, source_table, source_id } = artifact;

  try {
    // 1. Get document text
    const { text, filename, mimeType } = await getDocumentText(
      sb,
      source_table,
      source_id,
      dealId
    );

    // 2. Classify the document
    const classification = await classifyDocument(text, filename, mimeType);

    // 3. Update artifact with classification
    await sb.rpc("update_artifact_classification", {
      p_artifact_id: artifactId,
      p_doc_type: classification.docType,
      p_doc_type_confidence: classification.confidence,
      p_doc_type_reason: classification.reason,
      p_tax_year: classification.taxYear,
      p_entity_name: classification.entityName,
      p_entity_type: classification.entityType,
      p_extraction_json: classification.rawExtraction,
      p_proposed_deal_name: classification.proposedDealName,
      p_proposed_deal_name_source: classification.proposedDealNameSource,
    });

    // 4. Find matching checklist keys
    const possibleKeys = mapDocTypeToChecklistKeys(
      classification.docType,
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

    // 6.5. STAMP deal_documents with authoritative classification (AI is single source of truth)
    const canonicalType = normalizeToCanonical(classification.docType);
    if (source_table === "deal_documents") {
      const docYears = classification.taxYear ? [classification.taxYear] : null;

      await sb
        .from("deal_documents")
        .update({
          document_type: canonicalType,
          doc_year: classification.taxYear,
          doc_years: docYears,
          classification_confidence: classification.confidence,
          classification_reason: classification.reason,
          entity_name: classification.entityName,
          checklist_key: mapDocTypeToChecklistKeys(classification.docType, classification.taxYear)[0] ?? null,
          match_confidence: classification.confidence,
          match_reason: classification.reason,
          match_source: "ai_classification",
        } as any)
        .eq("id", source_id);
    }

    // 6.6. Reconcile checklist (flips required items to received)
    const { reconcileChecklistForDeal } = await import(
      "@/lib/checklist/engine"
    );
    await reconcileChecklistForDeal({ sb, dealId });

    // 6.7. Recompute deal readiness
    const { recomputeDealReady } = await import("@/lib/deals/readiness");
    await recomputeDealReady(dealId);

    // 6.8. Auto-apply extracted deal name (replace garbage defaults only)
    // Priority: BUSINESS_TAX_RETURN > PERSONAL_TAX_RETURN > PFS. Other types don't set name.
    const nameEligibleTypes = ["BUSINESS_TAX_RETURN", "PERSONAL_TAX_RETURN", "PFS"];
    if (classification.proposedDealName && nameEligibleTypes.includes(canonicalType)) {
      try {
        const { isAutoGeneratedDealName } = await import("@/lib/deals/isAutoGeneratedDealName");
        const dealRes = await sb
          .from("deals")
          .select("display_name")
          .eq("id", dealId)
          .maybeSingle();
        const currentName = (dealRes.data as any)?.display_name ?? null;

        if (isAutoGeneratedDealName(currentName)) {
          await sb
            .from("deals")
            .update({
              display_name: classification.proposedDealName,
              name_source: classification.proposedDealNameSource ?? "doc_extraction",
              name_updated_at: new Date().toISOString(),
            })
            .eq("id", dealId);

          await logLedgerEvent({
            dealId,
            bankId,
            eventKey: "deal.name.auto_applied",
            uiState: "done",
            uiMessage: `Deal name set to "${classification.proposedDealName}"`,
            meta: {
              previous_name: currentName,
              new_name: classification.proposedDealName,
              source: classification.proposedDealNameSource,
              artifact_id: artifactId,
            },
          });
        }
      } catch (nameErr: any) {
        console.warn("[processArtifact] auto-apply deal name failed (non-fatal)", {
          dealId,
          error: nameErr?.message,
        });
      }
    }

    // 7. Log success
    await logLedgerEvent({
      dealId,
      bankId,
      eventKey: "artifact.processed",
      uiState: "done",
      uiMessage: `Document classified as ${classification.docType}`,
      meta: {
        artifact_id: artifactId,
        doc_type: classification.docType,
        confidence: classification.confidence,
        tax_year: classification.taxYear,
        matched_keys: matchedKeys,
        stamped: source_table === "deal_documents",
      },
    });

    return {
      ok: true,
      artifactId,
      classification,
      matchedKeys,
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
