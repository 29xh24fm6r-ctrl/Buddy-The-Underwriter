/**
 * GET /api/deals/{dealId}/decision/{snapshotId}/committee-status
 * 
 * Returns whether this decision requires credit committee approval
 * and the reasons why (based on bank policy rules).
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { requiresCreditCommittee } from "@/lib/decision/creditCommittee";

type Ctx = { params: Promise<{ dealId: string; snapshotId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { dealId, snapshotId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Fetch decision snapshot
  const { data: snapshot, error } = await sb
    .from("decision_snapshots")
    .select("*")
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

  // Evaluate credit committee requirement
  const evaluation = await requiresCreditCommittee({
    bankId,
    decisionSnapshot: snapshot
  });

  return NextResponse.json({
    ok: true,
    committee_required: evaluation.required,
    reasons: evaluation.reasons,
    policy: evaluation.policy
  });
}
