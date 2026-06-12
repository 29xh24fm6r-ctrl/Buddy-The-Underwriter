/**
 * GET /api/deals/{dealId}/decision/{snapshotId}/committee/status
 * 
 * Returns current credit committee voting status for this decision.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { getCommitteeStatus } from "@/lib/committee/committeeLogic";

type Ctx = { params: Promise<{ dealId: string; snapshotId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { dealId, snapshotId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Verify snapshot exists and belongs to this bank
  const { data: snapshot, error } = await sb
    .from("decision_snapshots")
    .select("id")
    .eq("id", snapshotId)
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .single();

  if (error || !snapshot) {
    return NextResponse.json(
      { ok: false, error: "Decision snapshot not found" },
      { status: 404 }
    );
  }

  // Get committee voting status
  const status = await getCommitteeStatus({ bankId, snapshotId });

  return NextResponse.json({
    ok: true,
    ...status
  });
}
