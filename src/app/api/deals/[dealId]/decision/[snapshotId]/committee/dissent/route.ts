/**
 * POST /api/deals/{dealId}/decision/{snapshotId}/committee/dissent
 * 
 * Record a formal dissent opinion from a committee member.
 * 
 * REQUEST:
 * {
 *   "dissent_reason": "Detailed explanation of disagreement"
 * }
 * 
 * Dissent is immutable once recorded and appears in:
 * - Committee minutes
 * - Regulator exports
 * - Decision audit trail
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
  const { dissent_reason } = body;

  if (!dissent_reason || dissent_reason.trim().length < 10) {
    return NextResponse.json(
      { ok: false, error: "Dissent reason must be at least 10 characters" },
      { status: 400 }
    );
  }

  // Record dissent (upsert allows updating dissent reason)
  const { error: dissentError } = await sb
    .from("credit_committee_dissent")
    .upsert({
      bank_id: bankId,
      deal_id: dealId,
      decision_snapshot_id: snapshotId,
      dissenter_user_id: userId,
      dissenter_name: userId, // Can enhance with real name from Clerk
      dissent_reason: dissent_reason.trim()
    });

  if (dissentError) {
    console.error("Failed to record dissent:", dissentError);
    return NextResponse.json(
      { ok: false, error: "Failed to record dissent" },
      { status: 500 }
    );
  }

  // Write audit event
  await sb.from("deal_events").insert({
    deal_id: dealId,
    bank_id: bankId,
    kind: "committee.dissent",
    payload: {
      snapshot_id: snapshotId,
      dissenter_user_id: userId,
      reason_length: dissent_reason.trim().length
    }
  });

  return NextResponse.json({
    ok: true,
    message: "Dissent recorded successfully"
  });
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { dealId, snapshotId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Verify snapshot exists
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

  // Fetch all dissent opinions for this snapshot
  const { data: dissent } = await sb
    .from("credit_committee_dissent")
    .select("*")
    .eq("decision_snapshot_id", snapshotId);

  return NextResponse.json({
    ok: true,
    dissent: dissent || []
  });
}
