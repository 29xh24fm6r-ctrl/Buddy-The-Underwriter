import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { deriveAutoIntelligenceState } from "@/lib/intelligence/auto/deriveAutoIntelligenceState";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/intelligence/auto
 * Returns current auto-intelligence pipeline state.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const sb = supabaseAdmin();

  const { data: run } = await sb
    .from("deal_intelligence_runs")
    .select("id, status, source, requested_at, started_at, completed_at, error_code, error_detail")
    .eq("deal_id", dealId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let steps: any[] = [];
  if (run) {
    const { data } = await sb
      .from("deal_intelligence_steps")
      .select("step_code, status, started_at, completed_at, summary, error_code, error_detail")
      .eq("intelligence_run_id", run.id)
      .order("step_code");
    steps = data ?? [];
  }

  const state = deriveAutoIntelligenceState(run, steps);

  return NextResponse.json({ ok: true, run, state });
}
