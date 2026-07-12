import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";

export async function GET(_: Request, ctx: { params: Promise<{ token: string }> }) {
  const sb = supabaseAdmin();
  const { token } = await ctx.params;

  const { data: link, error } = await sb
    .from("borrower_portal_links")
    .select("deal_id, label, single_use, expires_at, used_at")
    .eq("token", token)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If the token isn't a portal link, fall back to a borrower_invites token so
  // the deal-workspace invite flow renders the same portal (the two token
  // systems were previously disjoint, leaving invited borrowers with a blank
  // portal header/checklist).
  let dealId = link?.deal_id ?? null;
  let linkMeta: { label: string | null; single_use: boolean | null; expires_at: string | null } = {
    label: link?.label ?? null,
    single_use: link?.single_use ?? null,
    expires_at: link?.expires_at ?? null,
  };
  if (!link) {
    try {
      const resolved = await resolveBorrowerToken(token);
      dealId = resolved.deal_id;
      linkMeta = { label: resolved.name ?? null, single_use: true, expires_at: null };
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 404 });
    }
  } else {
    if (link.expires_at && new Date(link.expires_at).getTime() < Date.now()) {
      return NextResponse.json({ error: "Token expired" }, { status: 410 });
    }
    // Optional: mark used_at for single-use on first visit
    if (link.single_use && !link.used_at) {
      await sb.from("borrower_portal_links").update({ used_at: new Date().toISOString() }).eq("token", token);
    }
  }

  // Pull minimal deal info for header
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("id, name, borrower_name, borrower_email, status, stage, city, state")
    .eq("id", dealId)
    .maybeSingle();

  if (dealErr) return NextResponse.json({ error: dealErr.message }, { status: 500 });

  let franchiseBrandName: string | null = null;
  if (dealId) {
    const { data: franchiseLink } = await sb
      .from("deal_franchises")
      .select("brand_id")
      .eq("deal_id", dealId)
      .maybeSingle();
    if (franchiseLink?.brand_id) {
      const { data: brand } = await sb
        .from("franchise_brands")
        .select("brand_name")
        .eq("id", franchiseLink.brand_id)
        .maybeSingle();
      franchiseBrandName = brand?.brand_name ?? null;
    }
  }

  return NextResponse.json({
    token,
    deal,
    link: linkMeta,
    franchise: franchiseBrandName ? { brandName: franchiseBrandName } : null,
  });
}
