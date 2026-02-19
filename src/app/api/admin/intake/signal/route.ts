/**
 * GET /api/admin/intake/signal
 *
 * Phase D — Intake Signal Intelligence Dashboard data endpoint.
 * Returns signal quality metrics from the four Phase D views plus
 * the existing slot_entity_binding_coverage_v1 view.
 *
 * Auth: requireSuperAdmin()
 * Fail-safe: empty arrays on view error (never 500 for view failures).
 * Pattern follows /api/admin/intake/reliability/route.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type SignalStrengthRow = {
  effective_doc_type: string | null;
  total_docs: number | null;
  avg_confidence: number | null;
  min_confidence: number | null;
  max_confidence: number | null;
  confidence_stddev: number | null;
  low_confidence_count: number | null;
  health_color: string | null;
};

type ClassifierSourceMixRow = {
  effective_doc_type: string | null;
  match_source: string | null;
  doc_count: number | null;
  fraction_within_type: number | null;
  avg_confidence: number | null;
};

type SegmentationImpactRow = {
  document_class: string | null;
  doc_count: number | null;
  avg_confidence: number | null;
  avg_classification_seconds: number | null;
  manual_override_rate: number | null;
};

type EntityBindingRow = {
  [key: string]: unknown;
};

type OverrideCorrelationRow = {
  effective_doc_type: string | null;
  total_docs: number | null;
  manual_override_count: number | null;
  recent_manual_count: number | null;
  manual_override_rate: number | null;
  avg_confidence: number | null;
  confidence_stddev: number | null;
  health_color: string | null;
};

type SignalResponse =
  | {
      ok: true;
      signalStrength: SignalStrengthRow[];
      classifierSourceMix: ClassifierSourceMixRow[];
      segmentationImpact: SegmentationImpactRow[];
      entityBindingCoverage: EntityBindingRow[];
      overrideSignalCorrelation: OverrideCorrelationRow[];
    }
  | {
      ok: false;
      error: string;
    };

// ---------------------------------------------------------------------------
// GET /api/admin/intake/signal
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
): Promise<NextResponse<SignalResponse>> {
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

    // Parallel queries — all fail-safe
    const [strengthRes, mixRes, segRes, bindingRes, correlationRes] =
      await Promise.all([
        (sb as any).from("intake_signal_strength_v1").select("*"),
        (sb as any).from("intake_classifier_source_mix_v1").select("*"),
        (sb as any).from("intake_segmentation_impact_v1").select("*"),
        (sb as any).from("slot_entity_binding_coverage_v1").select("*"),
        (sb as any).from("intake_override_signal_correlation_v1").select("*"),
      ]);

    if (strengthRes.error) {
      console.warn(
        "[admin/signal] signal strength query error (non-fatal):",
        strengthRes.error,
      );
    }
    if (mixRes.error) {
      console.warn(
        "[admin/signal] classifier source mix query error (non-fatal):",
        mixRes.error,
      );
    }
    if (segRes.error) {
      console.warn(
        "[admin/signal] segmentation impact query error (non-fatal):",
        segRes.error,
      );
    }
    if (bindingRes.error) {
      console.warn(
        "[admin/signal] entity binding coverage query error (non-fatal):",
        bindingRes.error,
      );
    }
    if (correlationRes.error) {
      console.warn(
        "[admin/signal] override correlation query error (non-fatal):",
        correlationRes.error,
      );
    }

    const signalStrength: SignalStrengthRow[] = (
      strengthRes.data ?? []
    ).map((r: any) => ({
      effective_doc_type: r.effective_doc_type ?? null,
      total_docs: r.total_docs != null ? Number(r.total_docs) : null,
      avg_confidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
      min_confidence: r.min_confidence != null ? Number(r.min_confidence) : null,
      max_confidence: r.max_confidence != null ? Number(r.max_confidence) : null,
      confidence_stddev:
        r.confidence_stddev != null ? Number(r.confidence_stddev) : null,
      low_confidence_count:
        r.low_confidence_count != null ? Number(r.low_confidence_count) : null,
      health_color: r.health_color ?? null,
    }));

    const classifierSourceMix: ClassifierSourceMixRow[] = (
      mixRes.data ?? []
    ).map((r: any) => ({
      effective_doc_type: r.effective_doc_type ?? null,
      match_source: r.match_source ?? null,
      doc_count: r.doc_count != null ? Number(r.doc_count) : null,
      fraction_within_type:
        r.fraction_within_type != null ? Number(r.fraction_within_type) : null,
      avg_confidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
    }));

    const segmentationImpact: SegmentationImpactRow[] = (
      segRes.data ?? []
    ).map((r: any) => ({
      document_class: r.document_class ?? null,
      doc_count: r.doc_count != null ? Number(r.doc_count) : null,
      avg_confidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
      avg_classification_seconds:
        r.avg_classification_seconds != null
          ? Number(r.avg_classification_seconds)
          : null,
      manual_override_rate:
        r.manual_override_rate != null ? Number(r.manual_override_rate) : null,
    }));

    const entityBindingCoverage: EntityBindingRow[] = bindingRes.data ?? [];

    const overrideSignalCorrelation: OverrideCorrelationRow[] = (
      correlationRes.data ?? []
    ).map((r: any) => ({
      effective_doc_type: r.effective_doc_type ?? null,
      total_docs: r.total_docs != null ? Number(r.total_docs) : null,
      manual_override_count:
        r.manual_override_count != null ? Number(r.manual_override_count) : null,
      recent_manual_count:
        r.recent_manual_count != null ? Number(r.recent_manual_count) : null,
      manual_override_rate:
        r.manual_override_rate != null ? Number(r.manual_override_rate) : null,
      avg_confidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
      confidence_stddev:
        r.confidence_stddev != null ? Number(r.confidence_stddev) : null,
      health_color: r.health_color ?? null,
    }));

    return NextResponse.json({
      ok: true,
      signalStrength,
      classifierSourceMix,
      segmentationImpact,
      entityBindingCoverage,
      overrideSignalCorrelation,
    });
  } catch (e: any) {
    console.error("[admin/signal] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
