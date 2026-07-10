import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadLastEvents } from "../_components/loadLastEvents";
import { StuckTable, type StuckRow } from "../_components/StuckTable";
import { brokerageColors as c } from "@/components/brokerage/tokens";

export const dynamic = "force-dynamic";

/**
 * Uploads pending OCR — `deal_documents` with `finalized_at IS NULL`.
 * Oldest first so the most-stuck appear at the top. SPEC-BROKERAGE-
 * LAUNCH-BLOCKERS-V1 §3.6.
 */
export default async function BrokerageUploadsPage() {
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("deal_documents")
    .select("id, deal_id, original_filename, uploaded_at, finalized_at")
    .is("finalized_at", null)
    .order("uploaded_at", { ascending: true })
    .limit(50);

  const docs = (data ?? []) as Array<{
    id: string;
    deal_id: string;
    original_filename: string | null;
    uploaded_at: string;
  }>;

  const lastEvents = await loadLastEvents(docs.map((d) => d.deal_id));
  const now = new Date().valueOf();

  const rows: StuckRow[] = docs.map((d) => {
    const uploaded = new Date(d.uploaded_at).getTime();
    return {
      id: d.id,
      display_name: d.original_filename,
      age_iso: d.uploaded_at,
      age_seconds: Math.max(0, Math.floor((now - uploaded) / 1000)),
      last_event_action: lastEvents.get(d.deal_id) ?? null,
    };
  });

  return (
    <div style={{ padding: "18px 24px 40px" }}>
      {error && (
        <div style={{ border: `1px solid ${c.brick}`, background: "rgba(168,93,82,.1)", color: c.brick, fontSize: 12, padding: 12, borderRadius: 6, marginBottom: 16 }}>
          {error.message}
        </div>
      )}

      <StuckTable rows={rows} emptyLabel="No uploads stuck in OCR." />
    </div>
  );
}
