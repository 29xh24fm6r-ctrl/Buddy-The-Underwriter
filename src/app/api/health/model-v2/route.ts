import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isModelEngineV2Enabled } from "@/lib/modelEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health/model-v2
 *
 * Unauthenticated health endpoint — production truth source for V2 status.
 * Returns JSON always, never HTML.
 *
 * Optional: ?writeCheckDealId=<uuid> triggers a snapshot write test (non-fatal).
 */
export async function GET(req: NextRequest) {
  try {
    const sb = supabaseAdmin();
    const enabled = isModelEngineV2Enabled();

    // Metric definitions count
    const { count: metricCount, error: metricErr } = await sb
      .from("metric_definitions")
      .select("*", { count: "exact", head: true })
      .eq("version", "v1");

    // Snapshots count
    const { count: snapshotCount, error: snapshotErr } = await sb
      .from("deal_model_snapshots")
      .select("*", { count: "exact", head: true });

    // Registry load check
    let registryOk = false;
    let registrySource: "db" | "seed" | "error" = "error";
    try {
      const { loadMetricRegistry } = await import("@/lib/modelEngine");
      const defs = await loadMetricRegistry(sb, "v1");
      registryOk = defs.length > 0;
      registrySource = metricCount && metricCount > 0 && defs.length === metricCount ? "db" : "seed";
    } catch {
      registryOk = false;
    }

    // Diff events count
    const { count: diffEventCount } = await (sb as any)
      .from("buddy_system_events")
      .select("*", { count: "exact", head: true })
      .eq("error_code", "MOODYS_RENDER_DIFF");

    // Optional write-check: attempt to persist a snapshot for a specific deal
    const url = new URL(req.url);
    const writeCheckDealId = url.searchParams.get("writeCheckDealId");
    let snapshotWrite: { ok: boolean; snapshotId?: string; error?: string } | undefined;

    if (writeCheckDealId && enabled) {
      try {
        const { buildFinancialModel } = await import("@/lib/modelEngine");
        const { persistModelV2SnapshotFromDeal } = await import(
          "@/lib/modelEngine/services/persistModelV2SnapshotFromDeal"
        );

        // Load facts for the deal
        const { data: facts } = await (sb as any)
          .from("deal_financial_facts")
          .select("fact_type, fact_key, fact_value_num, fact_period_end, confidence")
          .eq("deal_id", writeCheckDealId)
          .neq("fact_type", "EXTRACTION_HEARTBEAT");

        const model = buildFinancialModel(writeCheckDealId, facts ?? []);
        // Look up bank_id from the deal
        const { data: deal } = await sb
          .from("deals")
          .select("bank_id")
          .eq("id", writeCheckDealId)
          .maybeSingle();

        const result = await persistModelV2SnapshotFromDeal({
          dealId: writeCheckDealId,
          bankId: deal?.bank_id ?? "",
          model,
        });

        snapshotWrite = result
          ? { ok: true, snapshotId: result.snapshotId ?? undefined }
          : { ok: false, error: "persist returned null" };
      } catch (e: any) {
        snapshotWrite = { ok: false, error: e?.message ?? "write_check_failed" };
      }
    }

    return NextResponse.json({
      ok: true,
      status: "healthy",
      v2_enabled: enabled,
      metric_definitions: {
        count: metricCount ?? 0,
        error: metricErr?.message ?? null,
      },
      deal_model_snapshots: {
        count: snapshotCount ?? 0,
        error: snapshotErr?.message ?? null,
      },
      diff_events: {
        count: diffEventCount ?? 0,
      },
      registry: {
        loaded: registryOk,
        source: registrySource,
      },
      ...(snapshotWrite ? { snapshot_write: snapshotWrite } : {}),
      checked_at: new Date().toISOString(),
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      status: "error",
      error: e?.message ?? "unexpected_error",
      checked_at: new Date().toISOString(),
    }, { status: 500 });
  }
}
