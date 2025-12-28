import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(req: Request, ctx: { params: Promise<{ token: string; uploadId: string }> }) {
  const sb = supabaseAdmin();
  const { token, uploadId } = await ctx.params;

  const body = await req.json().catch(() => null);
  if (!body?.field_id) return NextResponse.json({ error: "field_id required" }, { status: 400 });

  const { data: link } = await sb
    .from("borrower_portal_links")
    .select("deal_id")
    .eq("token", token)
    .maybeSingle();

  if (!link) return NextResponse.json({ error: "Invalid token" }, { status: 404 });

  const { error } = await sb
    .from("doc_fields")
    .update({ confirmed: true, needs_attention: false, confirmed_at: new Date().toISOString() })
    .eq("id", body.field_id)
    .eq("deal_id", link.deal_id)
    .eq("upload_id", uploadId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
