import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: Promise<{ dealId: string }> }) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const rows = await sb
    .from("borrower_upload_inbox")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (rows.error) return NextResponse.json({ ok: false, error: rows.error.message }, { status: 400 });
  return NextResponse.json({ ok: true, rows: rows.data || [] });
}
