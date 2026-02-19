import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type DailyRow = {
  day: string;
  engine_version: string | null;
  auto_attached: number;
  routed_to_review: number;
  no_match: number;
  total: number;
  overrides: number;
};

type ConfusionCluster = {
  from_type: string | null;
  to_type: string | null;
  count: number;
  last_seen: string;
};

type IntakeMetricsResponse =
  | {
      ok: true;
      summary: {
        total_match_events: number;
        auto_attached: number;
        routed_to_review: number;
        no_match: number;
        auto_attach_rate: number;
        override_count: number;
      };
      daily: DailyRow[];
      confusion_clusters: ConfusionCluster[];
    }
  | {
      ok: false;
      error: string;
    };

// ---------------------------------------------------------------------------
// GET /api/metrics/intake
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
): Promise<NextResponse<IntakeMetricsResponse>> {
  // ── Auth ─────────────────────────────────────────────────────────────
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

    // ── Fetch daily metrics (last 30 days) ─────────────────────────────
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { data: dailyRows, error: dailyError } = await sb
      .from("v_intake_global_metrics")
      .select("*")
      .gte("day", thirtyDaysAgo.toISOString())
      .order("day", { ascending: false });

    if (dailyError) {
      console.error("[intake-metrics] daily query error:", dailyError);
      return NextResponse.json(
        { ok: false, error: dailyError.message },
        { status: 500 },
      );
    }

    // ── Fetch confusion clusters (top 20) ──────────────────────────────
    const { data: clusterRows, error: clusterError } = await sb
      .from("v_override_clusters")
      .select("*")
      .limit(20);

    if (clusterError) {
      console.error("[intake-metrics] cluster query error:", clusterError);
      return NextResponse.json(
        { ok: false, error: clusterError.message },
        { status: 500 },
      );
    }

    // ── Build daily array ──────────────────────────────────────────────
    const daily: DailyRow[] = (dailyRows ?? []).map((r: any) => ({
      day: r.day,
      engine_version: r.engine_version ?? null,
      auto_attached: Number(r.auto_attached ?? 0),
      routed_to_review: Number(r.routed_to_review ?? 0),
      no_match: Number(r.no_match ?? 0),
      total: Number(r.total ?? 0),
      overrides: Number(r.overrides ?? 0),
    }));

    // ── Build confusion clusters ───────────────────────────────────────
    const confusion_clusters: ConfusionCluster[] = (clusterRows ?? []).map(
      (r: any) => ({
        from_type: r.from_type ?? null,
        to_type: r.to_type ?? null,
        count: Number(r.override_count ?? 0),
        last_seen: r.last_seen,
      }),
    );

    // ── Aggregate summary from daily data ──────────────────────────────
    let totalAutoAttached = 0;
    let totalRoutedToReview = 0;
    let totalNoMatch = 0;
    let totalMatchEvents = 0;
    let totalOverrides = 0;

    for (const row of daily) {
      totalAutoAttached += row.auto_attached;
      totalRoutedToReview += row.routed_to_review;
      totalNoMatch += row.no_match;
      totalMatchEvents += row.total;
      totalOverrides += row.overrides;
    }

    const autoAttachRate =
      totalMatchEvents > 0
        ? Math.round((totalAutoAttached / totalMatchEvents) * 10000) / 10000
        : 0;

    return NextResponse.json({
      ok: true,
      summary: {
        total_match_events: totalMatchEvents,
        auto_attached: totalAutoAttached,
        routed_to_review: totalRoutedToReview,
        no_match: totalNoMatch,
        auto_attach_rate: autoAttachRate,
        override_count: totalOverrides,
      },
      daily,
      confusion_clusters,
    });
  } catch (e: any) {
    console.error("[intake-metrics] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
