import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";

export async function POST(req: Request, ctx: { params: Promise<{ token: string; uploadId: string }> }) {
  const sb = supabaseAdmin();
  const { token, uploadId } = await ctx.params;

  const body = await req.json().catch(() => null);
  if (!body?.field_id) return NextResponse.json({ error: "field_id required" }, { status: 400 });

  let dealId: string;
  try {
    dealId = (await resolveBorrowerToken(token)).deal_id;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  }

  const { error } = await sb
    .from("doc_fields")
    .update({ confirmed: true, needs_attention: false, confirmed_at: new Date().toISOString() })
    .eq("id", body.field_id)
    .eq("deal_id", dealId)
    .eq("upload_id", uploadId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
