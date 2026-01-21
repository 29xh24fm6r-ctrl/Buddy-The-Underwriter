import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { reconcileUploadsForDeal } from "@/lib/documents/reconcileUploads";
import { logLedgerEvent } from "@/lib/pipeline/logLedgerEvent";

export type RecordUploadArgs = {
  dealId: string;
  bankId: string;
  requestId?: string | null; // borrower_document_requests.id (NOT upload link id)
  storageBucket: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt?: string | null;
  source?: "borrower_portal" | "banker_upload" | "public_link" | "unknown";
  /**
   * When true (default), materialize borrower_uploads → deal_documents via reconcile engine.
   * Set false in routes that already call ingestDocument.
   */
  materialize?: boolean;
};

async function ensureBorrowerUploadRow(sb: ReturnType<typeof supabaseAdmin>, args: RecordUploadArgs) {
  // Best-effort idempotency: borrower_uploads has no unique constraint.
  // We de-dupe by (deal_id, bank_id, storage_path).
  const existing = await sb
    .from("borrower_uploads")
    .select("id")
    .eq("deal_id", args.dealId)
    .eq("bank_id", args.bankId)
    .eq("storage_path", args.storagePath)
    .maybeSingle();

  if (existing.data?.id) {
    return { uploadId: String(existing.data.id), created: false };
  }

  // Repair path: sometimes uploads are recorded without deal_id. Fix and log.
  const orphan = await sb
    .from("borrower_uploads")
    .select("id, deal_id")
    .eq("bank_id", args.bankId)
    .eq("storage_path", args.storagePath)
    .is("deal_id", null)
    .maybeSingle();

  if (orphan.data?.id) {
    await sb
      .from("borrower_uploads")
      .update({ deal_id: args.dealId })
      .eq("id", orphan.data.id);

    await logLedgerEvent({
      dealId: args.dealId,
      bankId: args.bankId,
      eventKey: "deal.uploads.repaired",
      uiState: "done",
      uiMessage: "Repaired orphaned upload",
      meta: {
        repaired: 1,
        borrower_upload_id: orphan.data.id,
        storage_path: args.storagePath,
        storage_bucket: args.storageBucket,
      },
    });

    return { uploadId: String(orphan.data.id), created: false };
  }

  const uploadedAt = args.uploadedAt ?? new Date().toISOString();

  const ins = await sb
    .from("borrower_uploads")
    .insert({
      deal_id: args.dealId,
      bank_id: args.bankId,
      request_id: args.requestId ?? null,
      storage_bucket: args.storageBucket,
      storage_path: args.storagePath,
      original_filename: args.originalFilename,
      mime_type: args.mimeType || null,
      size_bytes: args.sizeBytes ?? null,
      uploaded_at: uploadedAt,
    } as any)
    .select("id")
    .single();

  if (ins.error || !ins.data?.id) {
    throw new Error(ins.error?.message || "Failed to insert borrower_uploads");
  }

  return { uploadId: String(ins.data.id), created: true };
}

/**
 * Canonical post-commit side effects:
 * 1) Write borrower_uploads audit row
 * 2) (Optional) Materialize into deal_documents via reconcile engine
 * 3) Log pipeline ledger event_key=upload_commit
 */
export async function recordBorrowerUploadAndMaterialize(args: RecordUploadArgs) {
  const sb = supabaseAdmin();

  const upload = await ensureBorrowerUploadRow(sb, args);

  let reconciled = 0;
  if (args.materialize !== false) {
    const r = await reconcileUploadsForDeal(args.dealId, args.bankId);
    reconciled = r.matched;
  }

  await logLedgerEvent({
    dealId: args.dealId,
    bankId: args.bankId,
    eventKey: "upload_commit",
    uiState: "done",
    uiMessage: `Upload committed${args.materialize === false ? "" : `. Materialized ${reconciled} docs`}`,
    meta: {
      source: args.source ?? "unknown",
      borrower_upload_id: upload.uploadId,
      borrower_upload_created: upload.created,
      storage_bucket: args.storageBucket,
      storage_path: args.storagePath,
      original_filename: args.originalFilename,
      mime_type: args.mimeType,
      size_bytes: args.sizeBytes,
      reconciled,
    },
  });

  return {
    uploadId: upload.uploadId,
    uploadCreated: upload.created,
    reconciled,
  };
}
