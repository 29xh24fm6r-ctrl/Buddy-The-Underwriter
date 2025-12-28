/**
 * GET /api/deals/[dealId]/decision/[snapshotId] - Get specific snapshot
 * POST /api/deals/[dealId]/decision/[snapshotId] - Finalize snapshot
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { writeDealEvent } from "@/lib/events/dealEvents";
import { emitSmsIntent } from "@/lib/notify/smsIntent";

type Ctx = { params: Promise<{ dealId: string; snapshotId: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { dealId, snapshotId } = await ctx.params;
  await getCurrentBankId();
  const sb = supabaseAdmin();

  const { data: snapshot, error } = await sb
    .from("decision_snapshots")
    .select("*")
    .eq("id", snapshotId)
    .eq("deal_id", dealId)
    .single();

  if (error) {
    console.error("Failed to fetch snapshot", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, snapshot });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { dealId, snapshotId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();
  const body = await req.json();

  const { status, userId } = body;

  if (!["draft", "final", "superseded"].includes(status)) {
    return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
  }

  const { data: snapshot, error } = await sb
    .from("decision_snapshots")
    .update({ status })
    .eq("id", snapshotId)
    .eq("deal_id", dealId)
    .select()
    .single();

  if (error) {
    console.error("Failed to update snapshot", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Log status change
  await writeDealEvent({
    dealId,
    bankId,
    kind: `decision_snapshot_${status}`,
    actorUserId: userId,
    actorRole: "underwriter",
    title: `Decision snapshot marked ${status}`,
    payload: { snapshot_id: snapshotId, status },
  });

  // Optional: SMS intent (wire borrower phone retrieval when available)
  // const borrowerPhone = null;
  // if (status === "final" && borrowerPhone) {
  //   await emitSmsIntent({
  //     dealId,
  //     to: borrowerPhone,
  //     template: "decision_finalized",
  //     vars: { decision: snapshot.decision, snapshotId }
  //   });
  // }

  return NextResponse.json({ ok: true, snapshot });
}
