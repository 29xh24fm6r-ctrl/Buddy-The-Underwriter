import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type OverrideClusterRow = {
  from_type: string | null;
  to_type: string | null;
  override_count: number;
  avg_confidence_at_time: number | null;
  dominant_classifier_source: string | null;
  dominant_confidence_bucket: string | null;
  classification_version_range: string | null;
  segmentation_presence_ratio: number | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
};

type OverrideDriftRow = {
  week_start: string | null;
  from_type: string | null;
  to_type: string | null;
  classifier_source: string | null;
  classification_version: string | null;
  weekly_count: number;
  prev_week_count: number | null;
  delta: number;
};

type OverrideResponse =
  | {
      ok: true;
      clusters: OverrideClusterRow[];
      drift: OverrideDriftRow[];
    }
  | {
      ok: false;
      error: string;
    };

// ---------------------------------------------------------------------------
// GET /api/admin/intake/override
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
): Promise<NextResponse<OverrideResponse>> {
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

    // Query clusters — fail-safe: empty on error
    const { data: clusterData, error: clusterError } = await (sb as any)
      .from("override_clusters_v1")
      .select("*")
      .order("override_count", { ascending: false })
      .limit(100);

    if (clusterError) {
      console.warn("[admin/override] clusters query error (non-fatal):", clusterError);
    }

    // Query drift — last 4 weeks, descending delta — fail-safe: empty on error
    const { data: driftData, error: driftError } = await (sb as any)
      .from("override_drift_v1")
      .select("*")
      .order("week_start", { ascending: false })
      .order("delta", { ascending: false })
      .limit(100);

    if (driftError) {
      console.warn("[admin/override] drift query error (non-fatal):", driftError);
    }

    const clusters: OverrideClusterRow[] = (clusterData ?? []).map((r: any) => ({
      from_type: r.from_type ?? null,
      to_type: r.to_type ?? null,
      override_count: Number(r.override_count ?? 0),
      avg_confidence_at_time: r.avg_confidence_at_time != null ? Number(r.avg_confidence_at_time) : null,
      dominant_classifier_source: r.dominant_classifier_source ?? null,
      dominant_confidence_bucket: r.dominant_confidence_bucket ?? null,
      classification_version_range: r.classification_version_range ?? null,
      segmentation_presence_ratio: r.segmentation_presence_ratio != null ? Number(r.segmentation_presence_ratio) : null,
      first_seen_at: r.first_seen_at ?? null,
      last_seen_at: r.last_seen_at ?? null,
    }));

    const drift: OverrideDriftRow[] = (driftData ?? []).map((r: any) => ({
      week_start: r.week_start ?? null,
      from_type: r.from_type ?? null,
      to_type: r.to_type ?? null,
      classifier_source: r.classifier_source ?? null,
      classification_version: r.classification_version ?? null,
      weekly_count: Number(r.weekly_count ?? 0),
      prev_week_count: r.prev_week_count != null ? Number(r.prev_week_count) : null,
      delta: Number(r.delta ?? 0),
    }));

    return NextResponse.json({ ok: true, clusters, drift });
  } catch (e: any) {
    console.error("[admin/override] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
