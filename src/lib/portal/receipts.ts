// src/lib/portal/receipts.ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import { applyReceiptToChecklist } from "@/lib/portal/checklist";

export async function recordReceipt(params: {
  dealId: string;
  uploaderRole: "borrower" | "banker";
  filename: string;
  fileId?: string | null;
  meta?: any;
}) {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deal_document_receipts")
    .insert({
      deal_id: params.dealId,
      uploader_role: params.uploaderRole,
      filename: params.filename,
      file_id: params.fileId ?? null,
      meta: params.meta ?? null,
    })
    .select("*")
    .single();

  if (error) throw error;

  // Auto-highlight checklist items from receipt
  const result = await applyReceiptToChecklist({
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

  return { receipt: data, checklistUpdated: result.updated };
}

export async function listBorrowerReceipts(dealId: string) {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deal_document_receipts")
    .select("id, filename, received_at, uploader_role")
    .eq("deal_id", dealId)
    .order("received_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  return data ?? [];
}
