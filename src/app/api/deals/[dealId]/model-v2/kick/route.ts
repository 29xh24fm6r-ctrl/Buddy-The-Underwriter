import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { requireRole } from "@/lib/auth/requireRole";
import { isModelEngineV2Enabled, buildFinancialModel } from "@/lib/modelEngine";
import { persistModelV2SnapshotFromDeal } from "@/lib/modelEngine/services/persistModelV2SnapshotFromDeal";
import type { FactInput } from "@/lib/modelEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/model-v2/kick
 *
 * Auth-only endpoint to trigger a V2 model snapshot for a deal on demand.
 * Useful for production verification without relying on UI refresh.
 * Calls the same shared snapshot service as preview + moodys routes.
 */
export async function POST(_req: NextRequest, ctx: Ctx) {
  try {
    if (!isModelEngineV2Enabled()) {
      return NextResponse.json(
        { ok: false, error: "model_engine_v2_disabled" },
        { status: 404 },
      );
    }

    await requireRole(["super_admin", "bank_admin", "underwriter"]);

    const { dealId } = await ctx.params;
    const access = await ensureDealBankAccess(dealId);
    if (!access.ok) {
      return NextResponse.json(
        { ok: false, error: access.error },
        { status: access.error === "deal_not_found" ? 404 : 403 },
      );
    }

    const sb = supabaseAdmin();

    // Load facts
    const { data: rawFacts, error: factsErr } = await (sb as any)
      .from("deal_financial_facts")
      .select("fact_type, fact_key, fact_value_num, fact_period_end, confidence")
      .eq("deal_id", dealId)
      .eq("bank_id", access.bankId)
      .neq("fact_type", "EXTRACTION_HEARTBEAT");

    if (factsErr) {
      return NextResponse.json(
        { ok: false, error: `facts_load_failed: ${factsErr.message}` },
        { status: 500 },
      );
    }

    const facts: FactInput[] = (rawFacts ?? []).map((f: any) => ({
      fact_type: f.fact_type,
      fact_key: f.fact_key,
      fact_value_num: f.fact_value_num !== null ? Number(f.fact_value_num) : null,
      fact_period_end: f.fact_period_end,
      confidence: f.confidence !== null ? Number(f.confidence) : null,
    }));

    // Build model + persist snapshot
    const model = buildFinancialModel(dealId, facts);
    const result = await persistModelV2SnapshotFromDeal({
      dealId,
      bankId: access.bankId,
      model,
    });

    if (!result) {
      return NextResponse.json(
        { ok: false, error: "snapshot_persist_failed" },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      snapshotId: result.snapshotId,
      metricsComputed: Object.keys(result.computedMetrics).length,
      riskFlagCount: result.riskFlags.length,
    });
  } catch (e: any) {
    console.error("[/api/deals/[dealId]/model-v2/kick]", e);
    return NextResponse.json({ ok: false, error: "unexpected_error" }, { status: 500 });
  }
}
