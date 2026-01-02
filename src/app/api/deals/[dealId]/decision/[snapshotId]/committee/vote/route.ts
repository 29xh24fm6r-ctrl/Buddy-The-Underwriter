/**
 * POST /api/deals/{dealId}/decision/{snapshotId}/committee/vote
 * 
 * Submit a credit committee vote for a decision snapshot.
 * 
 * REQUEST:
 * {
 *   "vote": "approve" | "approve_with_conditions" | "decline",
 *   "comment": "Optional explanation"
 * }
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { isCommitteeMember } from "@/lib/committee/committeeLogic";

type Ctx = { params: Promise<{ dealId: string; snapshotId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { dealId, snapshotId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const { userId } = await clerkAuth();

  if (!userId) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const sb = supabaseAdmin();

  // Verify snapshot exists
  const { data: snapshot, error: snapshotError } = await sb
    .from("decision_snapshots")
    .select("id")
    .eq("id", snapshotId)
    .eq("deal_id", dealId)
    .eq("bank_id", bankId)
    .single();

  if (snapshotError || !snapshot) {
    return NextResponse.json(
      { ok: false, error: "Decision snapshot not found" },
      { status: 404 }
    );
  }

  // Verify user is committee member
  const eligible = await isCommitteeMember({ bankId, userId });
  if (!eligible) {
    return NextResponse.json(
      { ok: false, error: "User is not a credit committee member" },
      { status: 403 }
    );
  }

  // Parse request
  const body = await req.json();
  const { vote, comment } = body;

  if (!["approve", "approve_with_conditions", "decline"].includes(vote)) {
    return NextResponse.json(
      { ok: false, error: "Invalid vote value" },
      { status: 400 }
    );
  }

  // Get user name from Clerk (optional, for display)
  // For now, use userId as name (can enhance later)
  const voterName = userId;

  // Upsert vote (one vote per user per snapshot)
  const { error: voteError } = await sb
    .from("credit_committee_votes")
    .upsert({
      bank_id: bankId,
      deal_id: dealId,
      decision_snapshot_id: snapshotId,
      voter_user_id: userId,
      voter_name: voterName,
      vote,
      comment: comment || null
    });

  if (voteError) {
    console.error("Failed to record committee vote:", voteError);
    return NextResponse.json(
      { ok: false, error: "Failed to record vote" },
      { status: 500 }
    );
  }

  // Write audit event
  await sb.from("deal_events").insert({
    deal_id: dealId,
    bank_id: bankId,
    kind: "committee.vote",
    payload: {
      snapshot_id: snapshotId,
      voter_user_id: userId,
      vote,
      has_comment: !!comment
    }
  });

  return NextResponse.json({ ok: true });
}
