import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(
  _: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  try {
    await assertDealAccess(dealId);
  } catch (err) {
    const accessRes = accessErrorToResponse(err);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { ok: false, error: "access_check_failed" },
      { status: 500 },
    );
  }
  const sb = supabaseAdmin();

  const rows = await sb
    .from("borrower_upload_inbox")
    .select("*")
    .eq("deal_id", dealId)
    .order("created_at", { ascending: false });

  if (rows.error)
    return NextResponse.json(
      { ok: false, error: rows.error.message },
      { status: 400 },
    );
  return NextResponse.json({ ok: true, rows: rows.data || [] });
}
