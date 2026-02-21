import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isAdaptiveAutoAttachEnabled } from "@/lib/flags/adaptiveAutoAttach";
import { resolveAutoAttachThreshold } from "@/lib/classification/thresholds/resolveAutoAttachThreshold";
import {
  BASELINE_THRESHOLDS,
  ADAPTIVE_THRESHOLD_VERSION,
  type SpineTierKey,
  type CalibrationCurve,
  type CalibrationCell,
} from "@/lib/classification/thresholds/autoAttachThresholds";
import type { ConfidenceBand } from "@/lib/classification/calibrateConfidence";

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

type CalibrationCurveRow = {
  band: string | null;
  tier: string | null;
  total: number;
  overrides: number;
  override_rate: number | null;
};

type ResolvedThresholdRow = {
  tier: string;
  band: string;
  baseline: number;
  threshold: number;
  adapted: boolean;
  calibrationSamples: number;
  calibrationOverrideRate: number | null;
};

type OverrideResponse =
  | {
      ok: true;
      clusters: OverrideClusterRow[];
      drift: OverrideDriftRow[];
      calibration: CalibrationCurveRow[];
      resolvedThresholds: ResolvedThresholdRow[] | null;
      adaptiveVersion: string | null;
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

    // Query calibration curve — fail-safe: empty on error
    const { data: calibrationData, error: calibrationError } = await (sb as any)
      .from("classification_calibration_curve_v1")
      .select("*");

    if (calibrationError) {
      console.warn("[admin/override] calibration query error (non-fatal):", calibrationError);
    }

    const calibration: CalibrationCurveRow[] = (calibrationData ?? []).map((r: any) => ({
      band: r.band ?? null,
      tier: r.tier ?? null,
      total: Number(r.total ?? 0),
      overrides: Number(r.overrides ?? 0),
      override_rate: r.override_rate != null ? Number(r.override_rate) : null,
    }));

    // Compute resolved adaptive thresholds for all 12 cells (when flag is on)
    let resolvedThresholds: ResolvedThresholdRow[] | null = null;
    let adaptiveVersion: string | null = null;

    if (isAdaptiveAutoAttachEnabled()) {
      adaptiveVersion = ADAPTIVE_THRESHOLD_VERSION;
      const ALL_TIERS: SpineTierKey[] = ["tier1_anchor", "tier2_structural", "tier3_llm", "fallback"];
      const ALL_BANDS: ConfidenceBand[] = ["HIGH", "MEDIUM", "LOW"];

      // Build CalibrationCurve from calibration rows
      const curve: CalibrationCurve = calibration
        .filter((r): r is CalibrationCurveRow & { band: string; tier: string } => r.band != null && r.tier != null)
        .map((r) => ({
          tier: r.tier as SpineTierKey,
          band: r.band as ConfidenceBand,
          total: r.total,
          overrides: r.overrides,
          overrideRate: r.override_rate ?? 0,
        }));

      resolvedThresholds = [];
      for (const tier of ALL_TIERS) {
        for (const band of ALL_BANDS) {
          const result = resolveAutoAttachThreshold(tier, band, curve);
          resolvedThresholds.push({
            tier: result.tier,
            band: result.band,
            baseline: result.baseline,
            threshold: result.threshold,
            adapted: result.adapted,
            calibrationSamples: result.calibrationSamples,
            calibrationOverrideRate: result.calibrationOverrideRate,
          });
        }
      }
    }

    return NextResponse.json({ ok: true, clusters, drift, calibration, resolvedThresholds, adaptiveVersion });
  } catch (e: any) {
    console.error("[admin/override] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
