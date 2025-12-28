/**
 * GET /api/portal/[token]/guided/context - Get evidence items for guided submission
 * Extends existing portal pattern with /guided/* subroute
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const sb = supabaseAdmin();

  // Resolve token to deal (same pattern as existing portal routes)
  const { data: link } = await sb
    .from("borrower_upload_links")
    .select("deal_id, bank_id, expires_at")
    .eq("token", token)
    .single();

  if (!link || new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ ok: false, error: "Invalid or expired token" }, { status: 401 });
  }

  // Get decision snapshot evidence items
  const { data: snapshot } = await sb
    .from("decision_snapshots")
    .select("evidence_snapshot_json")
    .eq("deal_id", link.deal_id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const evidenceItems = snapshot?.evidence_snapshot_json?.items || [];

  return NextResponse.json({ ok: true, evidenceItems });
}
