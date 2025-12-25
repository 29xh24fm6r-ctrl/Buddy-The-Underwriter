import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireRole } from "@/lib/auth/requireRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string; memoId: string }> },
) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);

  const { dealId, memoId } = await ctx.params;
  const sb = supabaseAdmin();
  const { data, error } = await sb
    .from("credit_memo_citations")
    .select("*")
    .eq("deal_id", dealId)
    .eq("memo_draft_id", memoId)
    .order("created_at", { ascending: true });

  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  return NextResponse.json({ ok: true, citations: data || [] });
}
