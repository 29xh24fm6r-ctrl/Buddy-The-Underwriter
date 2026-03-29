import "server-only";

/**
 * POST /api/evals/run
 *
 * Admin-only. Runs the eval suite and persists results.
 */

import { NextResponse, type NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runEvalSuite } from "@/evals/runner";

export async function POST(req: NextRequest) {
  // Env gate — only enabled when EVAL_DASHBOARD_ENABLED=1
  if (process.env.EVAL_DASHBOARD_ENABLED !== "1") {
    return NextResponse.json({ ok: false, error: "Eval suite not enabled" }, { status: 403 });
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  try {
    const summary = runEvalSuite("facts_only");
    const sb = supabaseAdmin();

    // Persist run
    const { data: run } = await sb.from("buddy_eval_runs").insert({
      run_at: summary.runAt,
      mode: summary.mode,
      triggered_by: "manual",
      total_cases: summary.totalCases,
      passed_cases: summary.passedCases,
      failed_cases: summary.failedCases,
      overall_accuracy: summary.overallAccuracy,
      duration_ms: summary.durationMs,
    }).select("id").single();

    // Persist scores
    if (run) {
      for (const score of summary.scores) {
        await sb.from("buddy_eval_scores").insert({
          run_id: run.id,
          case_id: score.caseId,
          case_name: score.caseName,
          passed: score.passed,
          overall_score: score.overallScore,
          fact_accuracy: score.factAccuracy.score,
          ratio_accuracy: score.ratioAccuracy.score,
          incorrect_facts: score.factAccuracy.incorrect as any,
        });
      }
    }

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    console.error("[POST /api/evals/run]", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
