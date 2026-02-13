import "server-only";

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isModelEngineV2Enabled } from "@/lib/modelEngine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/health/model-v2
 *
 * Unauthenticated health endpoint — production truth source for V2 status.
 * Returns JSON always, never HTML.
 */
export async function GET() {
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
      // If count matches DB, it came from DB; otherwise seed fallback
      registrySource = metricCount && metricCount > 0 && defs.length === metricCount ? "db" : "seed";
    } catch {
      registryOk = false;
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
      registry: {
        loaded: registryOk,
        source: registrySource,
      },
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
