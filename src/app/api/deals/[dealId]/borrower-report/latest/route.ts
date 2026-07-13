import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { assertDealAccess } from "@/lib/server/deal-access";
import { accessErrorToResponse } from "@/lib/server/withDealAccess";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

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

  const { data } = await sb
    .from("buddy_borrower_reports")
    .select("*")
    .eq("deal_id", dealId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({ ok: true, report: data });
}
