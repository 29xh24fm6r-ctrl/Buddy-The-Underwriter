import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: { dealId: string } }) {
  const dealId = params.dealId;
  const sb = supabaseAdmin();

  const items = await sb
    .from("deal_checklist_items")
    .select("id, checklist_key, label, category, status, requested_at, received_at, waived_at, received_document_id, notes")
    .eq("deal_id", dealId)
    .order("category", { ascending: true })
    .order("label", { ascending: true });

  if (items.error) {
    return NextResponse.json({ ok: false, error: items.error.message }, { status: 500 });
  }

  const rows = items.data || [];
  const summary = {
    total: rows.length,
    missing: rows.filter((r: any) => r.status === "missing").length,
    requested: rows.filter((r: any) => r.status === "requested").length,
    received: rows.filter((r: any) => r.status === "received").length,
    waived: rows.filter((r: any) => r.status === "waived").length,
  };

  return NextResponse.json({ ok: true, summary, items: rows });
}
