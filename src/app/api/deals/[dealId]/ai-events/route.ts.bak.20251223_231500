// src/app/api/deals/[dealId]/ai-events/route.ts
import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: { dealId: string } }) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);

  const dealId = ctx.params.dealId;
  const url = new URL(req.url);
  const scope = url.searchParams.get("scope");
  const action = url.searchParams.get("action");
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") || 20)));

  const sb = supabaseAdmin();
  let q = sb
    .from("ai_events")
    .select("id, deal_id, scope, action, output_json, confidence, evidence_json, requires_human_review, created_at")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (scope) q = q.eq("scope", scope);
  if (action) q = q.eq("action", action);

  const { data, error } = await q;
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, events: data ?? [] });
}
