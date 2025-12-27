import { NextRequest } from "next/server";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { getAutopilotStatus } from "@/lib/autopilot/orchestrator";
import { calculateReadinessScore } from "@/lib/borrower/readiness-score";
import { generatePunchlist } from "@/lib/autopilot/punchlist";
import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * GET /api/deals/[dealId]/autopilot/status?runId=...
 * 
 * Returns live autopilot pipeline status including:
 * - Current stage and progress
 * - Stage logs
 * - Latest truth version
 * - Open conflicts
 * - Missing docs
 * - Readiness score
 * - Punchlist
 */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ dealId: string }> }
) {
  try {
    const { dealId } = await context.params;
    const bankId = await getCurrentBankId();

    if (!bankId) {
      return Response.json({ ok: false, error: "Bank ID required" }, { status: 400 });
    }

    const runId = req.nextUrl.searchParams.get("runId");

    const sb = supabaseAdmin();

    // Get pipeline run status
    let pipelineRun;
    if (runId) {
      pipelineRun = await getAutopilotStatus(runId);
    } else {
      // Get latest run for this deal
      const { data } = await sb
        .from("deal_pipeline_runs")
        .select("*")
        .eq("deal_id", dealId)
        .eq("bank_id", bankId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();

      pipelineRun = data;
    }

    // Get latest truth snapshot
    const { data: latestTruth } = await sb
      .from("deal_truth_snapshots")
      .select("*")
      .eq("deal_id", dealId)
      .order("version", { ascending: false })
      .limit(1)
      .single();

    // Get open conflicts count
    const { count: openConflictsCount } = await sb
      .from("claim_conflict_sets")
      .select("*", { count: "exact", head: true })
      .eq("deal_id", dealId)
      .eq("status", "open");

    // Calculate readiness score
    const readinessScore = await calculateReadinessScore(dealId, bankId);

    // Generate punchlist
    const punchlist = await generatePunchlist(dealId, bankId);

    return Response.json({
      ok: true,
      data: {
        pipeline: pipelineRun
          ? {
              run_id: pipelineRun.id,
              status: pipelineRun.status,
              current_stage: pipelineRun.current_stage,
              progress: pipelineRun.progress,
              stage_logs: pipelineRun.stage_logs,
              started_at: pipelineRun.started_at,
              finished_at: pipelineRun.finished_at,
              error: pipelineRun.error_json,
            }
          : null,
        truth: latestTruth
          ? {
              snapshot_id: latestTruth.id,
              version: latestTruth.version,
              overall_confidence: latestTruth.overall_confidence,
              needs_human: latestTruth.needs_human,
            }
          : null,
        conflicts: {
          open_count: openConflictsCount || 0,
        },
        readiness: readinessScore,
        punchlist,
      },
    });
  } catch (err) {
    console.error("[Autopilot Status] Error:", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
