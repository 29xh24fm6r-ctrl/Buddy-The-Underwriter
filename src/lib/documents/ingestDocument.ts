import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import {
  matchAndStampDealDocument,
  reconcileChecklistForDeal,
} from "@/lib/checklist/engine";

export type IngestSource =
  | "banker_upload"
  | "borrower_portal"
  | "public_link"
  | "system_backfill";

export interface IngestDocumentInput {
  dealId: string;
  bankId: string;
  file: {
    original_filename: string;
    mimeType: string;
    sizeBytes: number;
    storagePath: string;
  };
  source: IngestSource;
  uploaderUserId?: string;
  metadata?: Record<string, any>;
}

export async function ingestDocument(input: IngestDocumentInput) {
  const sb = supabaseAdmin();

  // 1️⃣ Insert canonical document row
  const { data: doc, error: insertErr } = await sb
    .from("deal_documents")
    .insert({
      deal_id: input.dealId,
      bank_id: input.bankId,
      original_filename: input.file.original_filename,
      mime_type: input.file.mimeType,
      size_bytes: input.file.sizeBytes,
      storage_path: input.file.storagePath,
      source: input.source,
      uploader_user_id: input.uploaderUserId ?? null,
      metadata: input.metadata ?? {},
    })
    .select()
    .single();

  if (insertErr || !doc) {
    throw insertErr ?? new Error("Failed to insert deal_document");
  }

  // 2️⃣ Emit upload-received ledger event
  await logLedgerEvent({
    dealId: input.dealId,
    bankId: input.bankId,
    eventKey: "upload_received",
    uiState: "working",
    uiMessage: "File received — processing started",
    meta: {
      document_id: doc.id,
      source: input.source,
    },
  });

  // 3️⃣ Match + stamp checklist metadata
  const stamped = await matchAndStampDealDocument({
    sb,
    dealId: input.dealId,
    documentId: doc.id,
    originalFilename: input.file.original_filename,
    mimeType: input.file.mimeType,
  });

  // 4️⃣ Reconcile checklist (year-aware)
  await reconcileChecklistForDeal({ sb, dealId: input.dealId });

  // 5️⃣ Emit checklist-updated ledger event
  await logLedgerEvent({
    dealId: input.dealId,
    bankId: input.bankId,
    eventKey: "checklist_reconciled",
    uiState: "done",
    uiMessage: "Checklist updated",
    meta: {
      document_id: doc.id,
      checklist_key: stamped.matched ? stamped.checklist_key : null,
      doc_year: stamped.matched ? stamped.doc_year : null,
    },
  });

  // 6️⃣ Canonical return
  return {
    documentId: doc.id,
    checklistKey: stamped.matched ? stamped.checklist_key ?? null : null,
    docYear: stamped.matched ? stamped.doc_year ?? null : null,
    matchConfidence: stamped.matched ? stamped.confidence ?? null : null,
    matchReason: stamped.matched ? "filename_match" : stamped.reason ?? "no_match",
  };
}
