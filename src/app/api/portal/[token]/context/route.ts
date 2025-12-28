import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(_: Request, ctx: { params: Promise<{ token: string }> }) {
  const sb = supabaseAdmin();
  const { token } = await ctx.params;

  const { data: link, error } = await sb
    .from("borrower_portal_links")
    .select("deal_id, label, single_use, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!link) return NextResponse.json({ error: "Invalid token" }, { status: 404 });
  if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
    return NextResponse.json({ error: "Token expired" }, { status: 410 });
  }

  // Optional: mark used_at for single-use on first visit
  if (link.single_use && !link.used_at) {
    await sb.from("borrower_portal_links").update({ used_at: new Date().toISOString() }).eq("token", token);
  }

  // Pull minimal deal info for header
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, name, borrower_name, borrower_email, status, stage, city, state")
    .eq("id", link.deal_id)
    .maybeSingle();

  if (dealErr) return NextResponse.json({ error: dealErr.message }, { status: 500 });

  return NextResponse.json({
    token,
    deal,
    link: { label: link.label, single_use: link.single_use, expires_at: link.expires_at },
  });
}
