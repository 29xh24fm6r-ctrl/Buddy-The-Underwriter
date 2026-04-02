/**
 * Borrower Financial Insights API — Canonical Contract
 *
 * GET /api/deals/[dealId]/borrower-insights
 *   Returns the canonical borrower insight payload from the latest completed run.
 *
 * POST /api/deals/[dealId]/borrower-insights
 *   Generates fresh borrower insights and returns the canonical payload.
 *
 * Both GET and POST return the same BorrowerInsightsApiResponse shape.
 */

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateBorrowerInsights } from "@/lib/borrowerReport/insightsEngine";
import {
  toBorrowerInsightsApiResponse,
  borrowerInsightRunRowToApiResponse,
} from "@/lib/borrowerReport/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("buddy_borrower_insight_runs")
    .select("deal_id, created_at, completed_at, insight_summary_json, scenario_json, benchmark_json")
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

  return NextResponse.json(borrowerInsightRunRowToApiResponse(data));
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
    return NextResponse.json(toBorrowerInsightsApiResponse(result));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[borrower-insights] generation failed", { dealId, error: message });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
