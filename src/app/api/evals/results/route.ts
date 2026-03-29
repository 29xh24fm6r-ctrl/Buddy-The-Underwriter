import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  if (process.env.EVAL_DASHBOARD_ENABLED !== "1") {
    return NextResponse.json({ ok: false, error: "Eval suite not enabled" }, { status: 403 });
  }

  const sb = supabaseAdmin();

  const { data: runs } = await sb
    .from("buddy_eval_runs")
    .select("id, run_at, mode, total_cases, passed_cases, failed_cases, overall_accuracy, duration_ms")
    .order("run_at", { ascending: false })
    .limit(20);

  // Get latest run scores
  const latestRun = runs?.[0];
  let latestScores: any[] = [];
  if (latestRun) {
    const { data: scores } = await sb
      .from("buddy_eval_scores")
      .select("case_id, case_name, passed, overall_score, fact_accuracy, ratio_accuracy, incorrect_facts")
      .eq("run_id", latestRun.id);
    latestScores = scores ?? [];
  }

  return NextResponse.json({ ok: true, runs: runs ?? [], latestScores });
}
