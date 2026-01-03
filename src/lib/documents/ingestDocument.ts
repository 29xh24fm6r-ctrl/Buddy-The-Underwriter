import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import {
  matchAndStampDealDocument,
  reconcileChecklistForDeal,
} from "@/lib/checklist/engine";

/**
 * IMPORTANT:
 * - DB check constraint for deal_documents.source is production-locked.
 * - We normalize app-level sources (banker_upload, borrower_portal, public_link, system_backfill)
 *   into DB-allowed values (internal, borrower, public, system).
 */
export type IngestSource =
  | "internal"
  | "borrower"
  | "public"
  | "system"
  | "sys"
  | "banker_upload"
  | "borrower_portal"
  | "public_link"
  | "system_backfill";

function normalizeDealDocumentSource(src: IngestSource): "internal" | "borrower" | "public" | "system" | "sys" {
  const v = String(src);

  // Canonical values (DB allowed)
  if (v === "internal") return "internal";
  if (v === "borrower") return "borrower";
  if (v === "public") return "public";
  if (v === "system") return "system";
  if (v === "sys") return "sys";

  // Legacy / caller aliases (app-level)
  if (v === "banker_upload") return "internal";
  if (v === "borrower_portal") return "borrower";
  if (v === "public_link") return "public";
  if (v === "system_backfill") return "system";

  // Safe fallback
  return "internal";
}

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
  // Optional override for document_key when callers have a better semantic key
  documentKey?: string | null;
  metadata?: Record<string, any>;
}

export async function ingestDocument(input: IngestDocumentInput) {
  const sb = supabaseAdmin();

  // Derive document_key (NOT NULL constraint)
  // Priority: explicit checklist_key > explicit documentKey > stable fallback
  const checklistKey = input.metadata?.checklist_key;
  const fallbackDocumentKey =
    input.documentKey ??
    `path:${input.file.storagePath}`.replace(/[^a-z0-9_:/-]/gi, "_");

  const documentKey = (checklistKey ?? fallbackDocumentKey) as string;

  // 1️⃣ Insert canonical document row
  const payload = {
    deal_id: input.dealId,
    bank_id: input.bankId,
    original_filename: input.file.original_filename,
    mime_type: input.file.mimeType,
    size_bytes: input.file.sizeBytes,
    storage_path: input.file.storagePath,
    source: normalizeDealDocumentSource(input.source),
    uploader_user_id: input.uploaderUserId ?? null,
    document_key: documentKey,
    metadata: input.metadata ?? {},
  };

  // Schema drift guard: fail immediately if we attempt to write a column that doesn't exist.
  const ALLOWED_DEAL_DOCUMENT_COLUMNS = new Set([
    "deal_id",
    "bank_id",
    "original_filename",
    "mime_type",
    "size_bytes",
    "storage_path",
    "source",
    "uploader_user_id",
    "document_key",
    "metadata",
  ]);

  for (const k of Object.keys(payload)) {
    if (!ALLOWED_DEAL_DOCUMENT_COLUMNS.has(k)) {
      throw new Error(
        `[ingestDocument] payload contains unknown deal_documents column: ${k}`
      );
    }
  }

  const { data: doc, error: insertErr } = await sb
    .from("deal_documents")
    .insert(payload)
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
      source: payload.source,
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
    matchReason: stamped.matched
      ? "filename_match"
      : stamped.reason ?? "no_match",
  };
}
