import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { userId } = await clerkAuth();
  if (!userId) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("buddy_validation_reports")
    .select("*")
    .eq("deal_id", dealId)
    .order("run_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) {
    return NextResponse.json({ ok: true, report: null });
  }

  return NextResponse.json({
    ok: true,
    report: {
      dealId,
      runAt: data.run_at,
      overallStatus: data.overall_status,
      gatingDecision: data.gating_decision,
      checks: data.checks,
      summary: data.summary,
      flagCount: data.flag_count,
      blockCount: data.block_count,
      snapshotHash: data.snapshot_hash,
    },
  });
}
