import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";
import { emitPipelineEvent } from "@/lib/pulseMcp/emitPipelineEvent";
import {
  matchAndStampDealDocument,
  reconcileChecklistForDeal,
} from "@/lib/checklist/engine";

/**
 * IMPORTANT:
 * This must align EXACTLY with the prod DB constraint:
 *
 * CHECK (source IN ('internal','borrower','public','system','sys'))
 */
export type CanonicalSource =
  | "internal"
  | "borrower"
  | "public"
  | "system"
  | "sys";

/**
 * All caller-level / legacy values funnel through here.
 * This is the ONLY place normalization should happen.
 */
function normalizeDealDocumentSource(src: unknown): CanonicalSource {
  const v = String(src ?? "").toLowerCase();

  // Canonical (already valid)
  if (v === "internal") return "internal";
  if (v === "borrower") return "borrower";
  if (v === "public") return "public";
  if (v === "system") return "system";
  if (v === "sys") return "sys";

  // Legacy / app-level aliases
  if (v === "banker_upload") return "internal";
  if (v === "borrower_portal") return "borrower";
  if (v === "public_link") return "public";
  if (v === "system_backfill") return "system";

  // Absolute safe fallback
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
    storageBucket?: string | null;
    sha256?: string | null;
  };
  source: unknown;
  uploaderUserId?: string | null;
  documentKey?: string | null;
  metadata?: Record<string, any>;
}

export async function ingestDocument(input: IngestDocumentInput) {
  const sb = supabaseAdmin();

  /**
   * Derive document_key (NOT NULL)
   * Priority:
   * 1. checklist_key (engine-driven)
   * 2. explicit documentKey
   * 3. stable path-based fallback
   */
  const checklistKey = input.metadata?.checklist_key ?? input.metadata?.task_checklist_key ?? null;
  const fallbackDocumentKey =
    input.documentKey ??
    `path:${input.file.storagePath}`.replace(/[^a-z0-9_:/-]/gi, "_");

  const documentKey = checklistKey ?? fallbackDocumentKey;

  const payload: any = {
    deal_id: input.dealId,
    bank_id: input.bankId,
    original_filename: input.file.original_filename,
    mime_type: input.file.mimeType,
    size_bytes: input.file.sizeBytes,
    storage_bucket: input.file.storageBucket ?? null,
    storage_path: input.file.storagePath,
    sha256: input.file.sha256 ?? null,
    source: normalizeDealDocumentSource(input.source),
    uploader_user_id: input.uploaderUserId ?? null,
    document_key: documentKey,
    metadata: input.metadata ?? {},
  };

  if (checklistKey) {
    payload.checklist_key = checklistKey;
    payload.match_source = "borrower_task";
    payload.match_reason = "task_selected";
    payload.match_confidence = 1.0;
    // Borrower task selection = fully matched, no AI needed → finalize immediately
    payload.finalized_at = new Date().toISOString();
  }

  /**
   * Hard schema guard — if this throws, someone edited code
   * without updating the DB schema.
   */
  const ALLOWED_COLUMNS = new Set([
    "deal_id",
    "bank_id",
    "original_filename",
    "mime_type",
    "size_bytes",
    "storage_bucket",
    "storage_path",
    "sha256",
    "source",
    "uploader_user_id",
    "document_key",
    "metadata",
    "checklist_key",
    "match_source",
    "match_reason",
    "match_confidence",
    "finalized_at",
  ]);

  for (const key of Object.keys(payload)) {
    if (!ALLOWED_COLUMNS.has(key)) {
      throw new Error(
        `[ingestDocument] Unknown deal_documents column attempted: ${key}`
      );
    }
  }

  const { data: doc, error } = await sb
    .from("deal_documents")
    .insert(payload)
    .select()
    .single();

  if (error || !doc) {
    throw error ?? new Error("Failed to insert deal_document");
  }

  // Ledger: upload received
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

  // Pulse: document uploaded
  void emitPipelineEvent({
    kind: "document_uploaded",
    deal_id: input.dealId,
    bank_id: input.bankId,
    payload: { document_type: payload.source },
  });

  // Checklist match + stamp
  const stamped = checklistKey
    ? { matched: true, checklist_key: checklistKey, doc_year: null, confidence: 1, reason: "task_selected" }
    : await matchAndStampDealDocument({
        sb,
        dealId: input.dealId,
        documentId: doc.id,
        originalFilename: input.file.original_filename,
        mimeType: input.file.mimeType,
        metadata: input.metadata ?? null,
      });

  // Reconcile checklist (year-aware)
  await reconcileChecklistForDeal({ sb, dealId: input.dealId });

  // Ledger: checklist updated
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

  return {
    documentId: doc.id,
    checklistKey: stamped.matched ? stamped.checklist_key ?? checklistKey ?? null : null,
    docYear: stamped.matched ? stamped.doc_year ?? null : null,
    matchConfidence: stamped.matched ? stamped.confidence ?? null : null,
    matchReason: stamped.matched
      ? stamped.reason ?? "matched"
      : stamped.reason ?? "no_match",
  };
}
