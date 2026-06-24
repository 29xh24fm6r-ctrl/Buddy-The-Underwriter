import "server-only";

import Link from "next/link";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { loadLastEvents } from "../_components/loadLastEvents";
import { StuckTable, type StuckRow } from "../_components/StuckTable";

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
    <main className="px-8 py-10 max-w-5xl mx-auto">
      <header className="mb-6 flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Uploads pending OCR</h1>
          <p className="text-sm text-neutral-400 mt-1">
            <code>deal_documents.finalized_at IS NULL</code>. Oldest first.
          </p>
        </div>
        <Link href="/admin/brokerage/listings" className="text-sm underline">
          Back to overview
        </Link>
      </header>

      {error && (
        <div className="rounded border border-red-700 bg-red-900/30 text-red-200 text-sm p-4 mb-6">
          {error.message}
        </div>
      )}

      <StuckTable rows={rows} emptyLabel="No uploads stuck in OCR." />
    </main>
  );
}
