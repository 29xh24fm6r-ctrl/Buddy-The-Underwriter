// src/lib/portal/receipts.ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyReceiptToChecklist } from "@/lib/portal/checklist";

/**
 * SCHEMA NOTE — read before editing the column list below.
 *
 * `deal_document_receipts` is created by TWO migrations, both using
 * CREATE TABLE IF NOT EXISTS, so whichever ran second was a silent no-op:
 *
 *   20251220000002_borrower_guided_upload_mode.sql
 *     id, deal_id, uploader_role, file_id, filename, received_at, meta
 *
 *   20251220000021_status_playbook_templates_and_doc_receipts.sql
 *     id, deal_id, file_name, doc_type, doc_year, source, received_by, received_at
 *
 * Production has the ...021 shape (verified against information_schema).
 * This module was written against ...002, so every borrower upload failed at
 * the recording step with "Could not find the 'file_id' column ... in the
 * schema cache" — after the file had already been signed, uploaded to GCS
 * and recorded in deal_documents.
 *
 * `file_id` was only the FIRST mismatch PostgREST reported: `uploader_role`,
 * `filename` and `meta` are also absent, and the real `file_name` column is
 * NOT NULL and was never being supplied. Adding one column would have moved
 * the error rather than fixed it.
 *
 * The columns below match production. The public shape of both functions is
 * deliberately unchanged so no caller needs modifying.
 */

/** Maps the uploader role onto the `source` column that production has. */
function sourceForRole(role: "borrower" | "banker"): string {
  return role === "borrower" ? "portal" : "banker";
}

export async function recordReceipt(params: {
  dealId: string;
  uploaderRole: "borrower" | "banker";
  filename: string;
  /**
   * Retained for call-site compatibility. Production has no `file_id`
   * column, so this is not persisted here — the authoritative link between
   * a stored object and a deal already lives in `deal_documents`.
   */
  fileId?: string | null;
  /**
   * Retained for call-site compatibility. Production has no `meta` column.
   * The one field with a real home is the checklist key, which maps onto
   * `doc_type`; the rest is already captured by the ledger and by
   * `deal_documents`.
   */
  meta?: { checklist_key?: string | null } & Record<string, unknown>;
  skipFilenameMatch?: boolean;
}) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_document_receipts")
    .insert({
      deal_id: params.dealId,
      file_name: params.filename,
      doc_type: params.meta?.checklist_key ?? null,
      source: sourceForRole(params.uploaderRole),
    })
    .select("id, file_name, doc_type, doc_year, source, received_at")
    .single();

  if (error) throw error;

  // Auto-highlight checklist items from receipt
  const result = params.skipFilenameMatch
    ? { updated: 0 }
    : await applyReceiptToChecklist({
        dealId: params.dealId,
        receiptId: data.id,
        filename: params.filename,
      });

  // Borrower-safe timeline celebration
  // Only safe info: "We received X"
  await sb.from("deal_timeline_events").insert({
    deal_id: params.dealId,
    visibility: "borrower",
    event_type: "DOC_RECEIVED",
    title: "Document received ✅",
    detail: `We received: ${params.filename}`,
    meta: { receiptId: data.id, checklistUpdated: result.updated },
  });

  // `filename` is preserved in the returned object so existing consumers
  // keep working against the same key they always used.
  return {
    receipt: { ...data, filename: data.file_name },
    checklistUpdated: result.updated,
  };
}

export async function listBorrowerReceipts(dealId: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deal_document_receipts")
    .select("id, file_name, received_at, source")
    .eq("deal_id", dealId)
    .order("received_at", { ascending: false })
    .limit(200);

  if (error) throw error;

  // This previously selected `filename` and `uploader_role`, neither of
  // which exists in production — so a borrower viewing their receipts would
  // have hit the same failure. The returned keys are kept identical for
  // callers, derived from the columns that do exist.
  return (data ?? []).map((row) => ({
    id: row.id,
    filename: row.file_name,
    received_at: row.received_at,
    uploader_role: row.source === "banker" ? "banker" : "borrower",
  }));
}
