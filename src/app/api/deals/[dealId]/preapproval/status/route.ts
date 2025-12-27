/**
 * GET /api/deals/[dealId]/preapproval/status
 * 
 * Get simulation run status and results.
 */

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

export async function GET(
  req: Request,
  context: { params: Promise<{ dealId: string }> }
) {
  const { dealId } = await context.params;
  const sb = supabaseAdmin();

  try {
    const bankId = await getCurrentBankId();
    const url = new URL(req.url);
    const runId = url.searchParams.get("runId");

    if (!runId) {
      return NextResponse.json(
        { ok: false, error: "runId query parameter required" },
        { status: 400 }
      );
    }

    // Get simulation run
    const { data: run, error: runErr } = await sb
      .from("preapproval_sim_runs")
      .select("*")
      .eq("id", runId)
      .eq("bank_id", bankId)
      .single();

    if (runErr || !run) {
      return NextResponse.json(
        { ok: false, error: "Simulation run not found" },
        { status: 404 }
      );
    }

    // Get simulation results (if completed)
    const { data: result } = await sb
      .from("preapproval_sim_results")
      .select("*")
      .eq("run_id", runId)
      .eq("bank_id", bankId)
      .single();

    return NextResponse.json({
      ok: true,
      run: {
        id: run.id,
        deal_id: run.deal_id,
        status: run.status,
        progress: run.progress,
        current_stage: run.current_stage,
        logs: run.logs || [],
        error: run.error_json,
        created_at: run.created_at,
        finished_at: run.finished_at,
      },
      result: result
        ? {
            id: result.id,
            sba_outcome: result.sba_outcome_json,
            conventional_outcome: result.conventional_outcome_json,
            offers: result.offers_json,
            punchlist: result.punchlist_json,
            truth: result.truth_json,
            confidence: result.confidence,
            created_at: result.created_at,
          }
        : null,
    });
  } catch (err: any) {
    console.error("[Preapproval] Status fetch failed:", err);
    return NextResponse.json(
      { ok: false, error: err.message ?? "Unknown error" },
      { status: 500 }
    );
  }
}
