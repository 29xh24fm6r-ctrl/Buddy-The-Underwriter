import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { logPipelineLedger } from "@/lib/pipeline/logPipelineLedger";
import { requireRole } from "@/lib/auth/requireRole";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/deals/:dealId/pipeline/reconcile
 * 
 * Reconciles deal metadata, document states, and conditions.
 * Logs all state transitions to deal_pipeline_ledger.
 * 
 * Features:
 * - Recalculates eligibility based on current doc state
 * - Updates aggregate completion %
 * - Re-runs condition checks
 * - Logs full before/after snapshot
 */
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> }
) {
  await requireRole(["super_admin", "bank_admin", "underwriter"]);
  const { dealId } = await ctx.params;
  const bankId = await getCurrentBankId();
  const sb = supabaseAdmin();

  // Fetch current deal state
  const { data: deal, error: dealErr } = await sb
    .from("deals")
    .select("*")
    .eq("id", dealId)
    .eq("bank_id", bankId)
    .single();

  if (dealErr || !deal) {
    return NextResponse.json(
      { ok: false, error: "Deal not found" },
      { status: 404 }
    );
  }

  // Snapshot before state
  const beforeState = {
    status: deal.status,
    underwriting_status: deal.underwriting_status,
    completion_percent: deal.completion_percent,
  };

  // Fetch doc states for completion calc
  const { data: docStates } = await sb
    .from("document_states")
    .select("status")
    .eq("deal_id", dealId);

  const totalDocs = docStates?.length || 0;
  const completedDocs = docStates?.filter((d) => d.status === "accepted").length || 0;
  const completionPercent = totalDocs > 0 ? Math.round((completedDocs / totalDocs) * 100) : 0;

  // Fetch conditions for eligibility check
  const { data: conditions } = await sb
    .from("conditions")
    .select("id, status")
    .eq("deal_id", dealId);

  const openConditions = conditions?.filter((c) => c.status !== "satisfied").length || 0;
  const eligibilityScore = openConditions === 0 ? 100 : Math.max(0, 100 - (openConditions * 10));

  // Update deal with reconciled state
  const { error: updateErr } = await sb
    .from("deals")
    .update({
      completion_percent: completionPercent,
      // Only auto-update status if it's in underwriting
      ...(deal.status === "underwriting" && completionPercent === 100
        ? { status: "review" }
        : {}),
    })
    .eq("id", dealId)
    .eq("bank_id", bankId);

  if (updateErr) {
    await logPipelineLedger(sb, {
      bank_id: bankId,
      deal_id: dealId,
      event_key: "pipeline_reconcile_failed",
      status: "error",
      payload: { error: updateErr.message },
    });
    return NextResponse.json(
      { ok: false, error: updateErr.message },
      { status: 500 }
    );
  }

  // Log successful reconciliation
  await logPipelineLedger(sb, {
    bank_id: bankId,
    deal_id: dealId,
    event_key: "pipeline_reconciled",
    status: "ok",
    payload: {
      before: beforeState,
      after: {
        completion_percent: completionPercent,
        eligibility_score: eligibilityScore,
        open_conditions: openConditions,
      },
      total_docs: totalDocs,
      completed_docs: completedDocs,
    },
  });

  return NextResponse.json({
    ok: true,
    reconciled: {
      completion_percent: completionPercent,
      eligibility_score: eligibilityScore,
      open_conditions: openConditions,
      total_docs: totalDocs,
      completed_docs: completedDocs,
    },
  });
}
