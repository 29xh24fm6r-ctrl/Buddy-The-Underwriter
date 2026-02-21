import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type KPIs = {
  total_uploads: number;
  total_classified: number;
  gate_held_pct: number | null;
  override_rate: number | null;
  quality_pass_pct: number | null;
  median_classify_time_s: number | null;
};

// ---------------------------------------------------------------------------
// GET /api/ops/intake/summary
//
// Aggregates KPIs from funnel + quality + override views.
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
): Promise<NextResponse> {
  try {
    await requireSuperAdmin();
  } catch {
    return NextResponse.json(
      { ok: false, error: "unauthorized" },
      { status: 401 },
    );
  }

  try {
    const sb = supabaseAdmin();

    const [funnelRes, qualityRes, overrideRes] = await Promise.all([
      (sb as any).from("intake_funnel_daily_v1").select("*"),
      (sb as any).from("intake_quality_daily_v1").select("*"),
      (sb as any).from("override_intel_daily_v1").select("*"),
    ]);

    if (funnelRes.error) {
      console.warn("[ops/intake/summary] funnel query error (non-fatal):", funnelRes.error);
    }
    if (qualityRes.error) {
      console.warn("[ops/intake/summary] quality query error (non-fatal):", qualityRes.error);
    }
    if (overrideRes.error) {
      console.warn("[ops/intake/summary] override query error (non-fatal):", overrideRes.error);
    }

    const funnelRows: any[] = funnelRes.data ?? [];
    const qualityRows: any[] = qualityRes.data ?? [];
    const overrideRows: any[] = overrideRes.data ?? [];

    // Aggregate funnel
    const totalUploads = funnelRows.reduce((s, r) => s + Number(r.uploaded ?? 0), 0);
    const totalClassified = funnelRows.reduce((s, r) => s + Number(r.classified ?? 0), 0);
    const totalGateHeld = funnelRows.reduce((s, r) => s + Number(r.gate_held ?? 0), 0);

    // Aggregate quality
    const totalPassed = qualityRows.reduce((s, r) => s + Number(r.passed ?? 0), 0);
    const totalQualityDocs = qualityRows.reduce((s, r) => s + Number(r.total_docs ?? 0), 0);

    // Aggregate overrides
    const totalOverrides = overrideRows.reduce((s, r) => s + Number(r.override_count ?? 0), 0);

    // Median classify time (average of per-day medians where available)
    const classifyTimes = funnelRows
      .filter((r: any) => r.median_upload_to_classify_s != null)
      .map((r: any) => Number(r.median_upload_to_classify_s));
    const avgMedianClassifyTime =
      classifyTimes.length > 0
        ? Math.round(
            (classifyTimes.reduce((s, v) => s + v, 0) / classifyTimes.length) * 10,
          ) / 10
        : null;

    const kpis: KPIs = {
      total_uploads: totalUploads,
      total_classified: totalClassified,
      gate_held_pct:
        totalClassified > 0
          ? Math.round((totalGateHeld / totalClassified) * 1000) / 10
          : null,
      override_rate:
        totalClassified > 0
          ? Math.round((totalOverrides / totalClassified) * 1000) / 10
          : null,
      quality_pass_pct:
        totalQualityDocs > 0
          ? Math.round((totalPassed / totalQualityDocs) * 1000) / 10
          : null,
      median_classify_time_s: avgMedianClassifyTime,
    };

    return NextResponse.json({ ok: true, kpis });
  } catch (e: any) {
    console.error("[ops/intake/summary] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
