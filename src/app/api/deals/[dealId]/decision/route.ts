/**
 * POST /api/deals/[dealId]/decision - Create decision snapshot
 * Creates immutable snapshot of underwriting decision + evidence + policy
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { writeDealEvent } from "@/lib/events/dealEvents";
import { stableHash } from "@/lib/decision/hash";

type Ctx = { params: Promise<{ dealId: string }> };

export async function POST(req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.error === "deal_not_found" ? 404 : 403 },
    );
  }
  const sb = supabaseAdmin();

  // Get current auth (for created_by_user_id)
  const body = await req.json();
  const userId = body.userId || null; // Must be passed from client

  const {
    decision,
    decision_summary,
    confidence,
    confidence_explanation,
    inputs_json,
    evidence_snapshot_json,
    policy_snapshot_json,
    policy_eval_json,
    exceptions_json,
    model_json,
  } = body;

  // Compute stable hash for integrity
  const hash = stableHash({
    decision,
    confidence,
    inputs_json,
    evidence_snapshot_json,
    policy_snapshot_json,
  });

  // Insert snapshot
  const { data: snapshot, error } = await sb
    .from("decision_snapshots")
    .insert({
      deal_id: dealId,
      created_by_user_id: userId,
      status: "draft",
      decision,
      decision_summary,
      confidence,
      confidence_explanation,
      inputs_json,
      evidence_snapshot_json,
      policy_snapshot_json,
      policy_eval_json,
      exceptions_json,
      model_json,
      hash,
    })
    .select()
    .single();

  if (error) {
    console.error("Failed to create decision snapshot", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Log to deal_events
  await writeDealEvent({
    dealId,
    bankId: access.bankId,
    kind: "decision_snapshot_created",
    actorUserId: userId,
    actorRole: "underwriter",
    title: `Decision snapshot created: ${decision}`,
    detail: decision_summary || "",
    payload: {
      snapshot_id: snapshot.id,
      decision,
      confidence,
    },
  });

  return NextResponse.json({ ok: true, snapshot });
}
