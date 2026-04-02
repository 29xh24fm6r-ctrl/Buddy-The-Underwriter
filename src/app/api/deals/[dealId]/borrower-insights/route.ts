/**
 * Borrower Financial Insights API — Phase 66A (Commit 10)
 *
 * GET /api/deals/[dealId]/borrower-insights
 *   Returns latest borrower financial insight run.
 *
 * POST /api/deals/[dealId]/borrower-insights
 *   Generates fresh borrower financial insights.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateBorrowerInsights } from "@/lib/borrowerReport/insightsEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("buddy_borrower_insight_runs")
    .select("*")
    .eq("deal_id", dealId)
    .eq("status", "complete")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "No borrower insights available" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    dealId,
    insight: data.insight_summary_json,
    scenarios: data.scenario_json,
    benchmarks: data.benchmark_json,
    warnings: data.warning_flags_json,
    generatedAt: data.created_at,
  });
}

export async function POST(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const { data: deal } = await sb
    .from("deals")
    .select("bank_id")
    .eq("id", dealId)
    .single();

  if (!deal?.bank_id) {
    return NextResponse.json({ error: "Deal not found" }, { status: 404 });
  }

  try {
    const result = await generateBorrowerInsights(sb, dealId, deal.bank_id);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[borrower-insights] generation failed", { dealId, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
