// src/lib/deals/docReceipts.ts
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function logDealDocumentReceipt(input: {
  dealId: string;
  fileName: string;
  docType?: string | null;
  docYear?: number | null;
  source?: string; // upload|email|portal|banker
  receivedBy?: string | null;
  receivedAtIso?: string | null; // optional override
}) {
  const sb = supabaseAdmin();

  // 1) Insert receipt (existing DB trigger writes deal_timeline_events)
  const payload = {
    deal_id: input.dealId,
    file_name: input.fileName,
    doc_type: input.docType ?? null,
    doc_year: input.docYear ?? null,
    source: input.source ?? "upload",
    received_by: input.receivedBy ?? null,
    received_at: input.receivedAtIso ?? null,
  };

  const { error } = await sb.from("deal_document_receipts").insert(payload);
  if (error) throw error;

  // 2) Best-effort: patch latest doc_received event with meta
  try {
    const { data: evs } = await sb
      .from("deal_timeline_events")
      .select("id, created_at")
      .eq("deal_id", input.dealId)
      .eq("kind", "doc_received")
      .order("created_at", { ascending: false })
      .limit(1);

    const ev = evs?.[0];
    if (ev?.id) {
      await sb
        .from("deal_timeline_events")
        .update({
          meta: {
            docType: input.docType ?? null,
            docYear: input.docYear ?? null,
            source: input.source ?? "upload",
            fileName: input.fileName,
          },
        })
        .eq("id", ev.id);
    }
  } catch {
    // ignore
  }

  return { ok: true };
}
