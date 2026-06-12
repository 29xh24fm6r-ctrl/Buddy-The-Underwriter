import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { fetchDealBankId } from "@/lib/deals/fetchDealContext";
import { recomputeDealReady } from "@/lib/deals/readiness";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ dealId: string; snapshotId: string }> }
) {
  const { dealId, snapshotId } = await ctx.params;
  const bankId = await getCurrentBankId();
  if (!bankId) {
    return NextResponse.json({ error: "No bank selected" }, { status: 401 });
  }

  const sb = supabaseAdmin();

  // Verify deal belongs to bank
  const dealBankId = await fetchDealBankId(dealId);
  if (dealBankId !== bankId) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  // Fetch snapshot
  const { data: snapshot, error: snapErr } = await sb
    .from("decision_snapshots")
    .select("id, status, decision")
    .eq("id", snapshotId)
    .eq("deal_id", dealId)
    .single();

  if (snapErr || !snapshot) {
    return NextResponse.json({ error: "Snapshot not found" }, { status: 404 });
  }

  if (snapshot.status === "final") {
    return NextResponse.json({ ok: true, already_final: true });
  }

  // Mark snapshot as final
  const { error: updateErr } = await sb
    .from("decision_snapshots")
    .update({ status: "final" })
    .eq("id", snapshotId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  // Advance deals.stage to decision_made
  await sb
    .from("deals")
    .update({ stage: "decision_made", updated_at: new Date().toISOString() })
    .eq("id", dealId);

  // Trigger lifecycle recompute (non-fatal)
  try {
    await recomputeDealReady(dealId);
  } catch (err: any) {
    console.warn("[finalize] recomputeDealReady failed (non-fatal)", err?.message);
  }

  return NextResponse.json({ ok: true, snapshotId, decision: snapshot.decision });
}
