/**
 * POST /api/deals/{dealId}/decision/{snapshotId}/committee/minutes
 * 
 * Generate credit committee meeting minutes from decision snapshot,
 * votes, attestations, and dissent opinions.
 * 
 * This is a one-time action triggered by a committee chair or admin.
 * Once generated, minutes are immutable.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { clerkAuth, isClerkConfigured } from "@/lib/auth/clerkServer";
import { generateCommitteeMinutes, getCommitteeMinutes } from "@/lib/committee/generateMinutes";

type Ctx = { params: Promise<{ dealId: string; snapshotId: string }> };

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

  // Fetch minutes (if they exist)
  const minutes = await getCommitteeMinutes({ snapshotId });

  if (!minutes) {
    return NextResponse.json({
      ok: true,
      exists: false
    });
  }

  return NextResponse.json({
    ok: true,
    exists: true,
    content: minutes.content,
    generated_at: minutes.generated_at,
    snapshot_hash: minutes.snapshot_hash
  });
}

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

  // Check if minutes already exist
  const existing = await getCommitteeMinutes({ snapshotId });
  if (existing) {
    return NextResponse.json(
      { ok: false, error: "Minutes already generated for this snapshot" },
      { status: 409 }
    );
  }

  // Generate minutes
  try {
    const content = await generateCommitteeMinutes({
      bankId,
      dealId,
      snapshotId,
      generatedByUserId: userId
    });

    return NextResponse.json({
      ok: true,
      content,
      message: "Committee minutes generated successfully"
    });
  } catch (err: any) {
    console.error("Failed to generate committee minutes:", err);
    return NextResponse.json(
      { ok: false, error: err.message || "Failed to generate minutes" },
      { status: 500 }
    );
  }
}
