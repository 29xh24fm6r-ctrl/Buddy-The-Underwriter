import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";

export async function GET(_: Request, ctx: { params: Promise<{ token: string; uploadId: string }> }) {
  const sb = supabaseAdmin();
  const { token, uploadId } = await ctx.params;

  // Only ever checked borrower_portal_links — a borrower who arrived via
  // the /apply wizard (borrower_invites token) always 404'd here, even
  // though the sibling /docs list route (which falls back correctly)
  // showed their uploaded docs fine.
  const { data: link, error: linkErr } = await sb
    .from("borrower_portal_links")
    .select("deal_id")
    .eq("token", token)
    .maybeSingle();

  if (linkErr) return NextResponse.json({ error: linkErr.message }, { status: 500 });

  let dealId = link?.deal_id ?? null;
  if (!link) {
    try {
      dealId = (await resolveBorrowerToken(token)).deal_id;
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    }
  }

  const { data: fields, error } = await sb
    .from("doc_fields")
    .select("id, field_key, field_label, field_value, needs_attention, confirmed, confirmed_at, updated_at")
    .eq("deal_id", dealId)
    .eq("upload_id", uploadId)
    .order("field_label", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ deal_id: dealId, upload_id: uploadId, fields: fields ?? [] });
}
