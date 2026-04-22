import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { rethrowNextErrors } from "@/lib/api/rethrowNextErrors";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ dealId: string; memoId: string }> },
) {

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
