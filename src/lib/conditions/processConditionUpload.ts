import "server-only";

/**
 * Phase 54A — Condition Upload Orchestration
 *
 * Orchestrates the full pipeline when a borrower uploads for a specific condition:
 * 1. Create condition→document intent link
 * 2. Trigger existing ingest + classification pipeline
 * 3. Return structured result
 *
 * Delegates to existing canonical helpers — does not duplicate pipeline logic.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { ingestDocument } from "@/lib/documents/ingestDocument";
import { queueArtifact } from "@/lib/artifacts/queueArtifact";
import { recomputeDealReady } from "@/lib/deals/readiness";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export type ConditionUploadResult = {
  ok: true;
  documentId: string;
  linkId: string;
  conditionId: string;
  classificationQueued: boolean;
  conditionStatus: "submitted";
} | {
  ok: false;
  error: string;
  stage: "link" | "ingest" | "queue" | "recompute";
};

export async function processConditionUpload(opts: {
  dealId: string;
  bankId: string;
  conditionId: string;
  file: {
    original_filename: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
    storageBucket: string;
    sha256?: string | null;
  };
  source: "borrower_portal";
  checklistKey?: string | null;
}): Promise<ConditionUploadResult> {
  const { dealId, bankId, conditionId, file, source, checklistKey } = opts;
  const sb = supabaseAdmin();

  // 1. Ingest document through canonical pipeline
  let documentId: string;
  try {
    const result = await ingestDocument({
      dealId,
      bankId,
      file: {
        original_filename: file.original_filename,
        mimeType: file.mimeType,
        sizeBytes: file.sizeBytes,
        storagePath: file.storagePath,
        storageBucket: file.storageBucket,
        sha256: file.sha256 ?? null,
      },
      source: "borrower",
      metadata: {
        task_checklist_key: checklistKey ?? null,
        condition_id: conditionId,
        skip_filename_match: true,
      },
    });
    documentId = result.documentId;
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      stage: "ingest",
    };
  }

  // 2. Create condition→document intent link
  let linkId: string;
  try {
    const { data: link, error: linkErr } = await sb
      .from("condition_document_links")
      .insert({
        deal_id: dealId,
        condition_id: conditionId,
        document_id: documentId,
        link_source: "borrower_targeted",
      })
      .select("id")
      .single();

    if (linkErr || !link) {
      throw new Error(linkErr?.message ?? "Failed to create condition link");
    }
    linkId = link.id;
  } catch (err) {
    // Link failure is non-fatal — document is already ingested
    console.error("[processConditionUpload] Link creation failed (non-fatal)", {
      dealId,
      conditionId,
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
    linkId = "link_failed";
  }

  // 3. Queue for classification pipeline (non-blocking)
  let classificationQueued = false;
  try {
    await queueArtifact({
      dealId,
      bankId,
      sourceTable: "deal_documents",
      sourceId: documentId,
    });
    classificationQueued = true;
  } catch (err) {
    console.warn("[processConditionUpload] queueArtifact failed (non-fatal)", {
      documentId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Log events
  await logLedgerEvent({
    dealId,
    bankId,
    eventKey: "condition.upload.received",
    uiState: "done",
    uiMessage: `Document uploaded for condition`,
    meta: {
      condition_id: conditionId,
      document_id: documentId,
      link_id: linkId,
      source,
      classification_queued: classificationQueued,
    },
  }).catch(() => {});

  // 5. Recompute readiness (non-blocking)
  recomputeDealReady(dealId).catch(() => {});

  return {
    ok: true,
    documentId,
    linkId,
    conditionId,
    classificationQueued,
    conditionStatus: "submitted",
  };
}
