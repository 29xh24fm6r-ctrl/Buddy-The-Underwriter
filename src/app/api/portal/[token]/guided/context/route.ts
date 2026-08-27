/**
 * GET /api/portal/[token]/guided/context - Get evidence items for guided submission
 * Extends existing portal pattern with /guided/* subroute
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveBorrowerToken } from "@/lib/portal/resolveBorrowerToken";

type Ctx = { params: Promise<{ token: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { token } = await ctx.params;
  const sb = supabaseAdmin();

  let dealId: string;
  try {
    dealId = (await resolveBorrowerToken(token)).deal_id;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid or expired token" },
      { status: 401 },
    );
  }

  // Get decision snapshot evidence items
  const { data: snapshot } = await sb
    .from("decision_snapshots")
    .select("evidence_snapshot_json")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const evidenceItems = snapshot?.evidence_snapshot_json?.items || [];

  return NextResponse.json({ ok: true, evidenceItems });
}
