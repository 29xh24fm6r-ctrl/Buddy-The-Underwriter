// src/app/api/deals/[dealId]/portal/notifications/route.ts
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
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  try {
    await assertDealAccess(dealId);
  } catch (err) {
    const accessRes = accessErrorToResponse(err);
    if (accessRes) return accessRes;
    return NextResponse.json(
      { error: "access_check_failed" },
      { status: 500 },
    );
  }
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("borrower_notifications")
    .select("id,title,body,created_at,status")
    .eq("deal_id", dealId)
    .eq("audience", "bank")
    .order("created_at", { ascending: false })
    .limit(25);

  if (error)
    return NextResponse.json(
      { error: "Failed to load notifications" },
      { status: 500 },
    );
  return NextResponse.json({ notifications: data || [] });
}
