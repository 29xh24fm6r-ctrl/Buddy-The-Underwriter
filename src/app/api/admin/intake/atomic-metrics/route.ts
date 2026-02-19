import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type SlotMetricRow = {
  slot_key: string;
  slot_id: string | null;
  engine_version: string | null;
  effective_doc_type: string | null;
  required_doc_type: string | null;
  auto_attached: number;
  routed_to_review: number;
  no_match: number;
  total_attempts: number;
  precision_rate: number | null;
  friction_rate: number | null;
};

type DocTypeMetricRow = {
  doc_type: string;
  engine_version: string | null;
  auto_attached: number;
  routed_to_review: number;
  no_match: number;
  total_match_events: number;
  override_count: number;
  auto_attach_rate: number | null;
  override_rate: number | null;
};

type ConfidenceBucket = {
  confidence_bucket: string;
  classification_tier: string | null;
  schema_version: string | null;
  event_count: number;
};

type AtomicMetricsResponse =
  | {
      ok: true;
      slotMetrics: SlotMetricRow[];
      docTypeMetrics: DocTypeMetricRow[];
      confidenceDistribution: ConfidenceBucket[];
    }
  | {
      ok: false;
      error: string;
    };

// ---------------------------------------------------------------------------
// GET /api/admin/intake/atomic-metrics
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
): Promise<NextResponse<AtomicMetricsResponse>> {
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

    const [slotResult, docTypeResult, confResult] = await Promise.all([
      sb.from("slot_attachment_metrics_v1").select("*"),
      sb.from("doc_type_performance_v1").select("*"),
      sb.from("confidence_distribution_v1").select("*"),
    ]);

    if (slotResult.error) {
      console.error("[atomic-metrics] slot query error:", slotResult.error);
      return NextResponse.json(
        { ok: false, error: slotResult.error.message },
        { status: 500 },
      );
    }
    if (docTypeResult.error) {
      console.error("[atomic-metrics] doc type query error:", docTypeResult.error);
      return NextResponse.json(
        { ok: false, error: docTypeResult.error.message },
        { status: 500 },
      );
    }
    if (confResult.error) {
      console.error("[atomic-metrics] confidence query error:", confResult.error);
      return NextResponse.json(
        { ok: false, error: confResult.error.message },
        { status: 500 },
      );
    }

    const slotMetrics: SlotMetricRow[] = (slotResult.data ?? []).map(
      (r: any) => ({
        slot_key: r.slot_key ?? "unknown",
        slot_id: r.slot_id ?? null,
        engine_version: r.engine_version ?? null,
        effective_doc_type: r.effective_doc_type ?? null,
        required_doc_type: r.required_doc_type ?? null,
        auto_attached: Number(r.auto_attached ?? 0),
        routed_to_review: Number(r.routed_to_review ?? 0),
        no_match: Number(r.no_match ?? 0),
        total_attempts: Number(r.total_attempts ?? 0),
        precision_rate:
          r.precision_rate != null ? Number(r.precision_rate) : null,
        friction_rate:
          r.friction_rate != null ? Number(r.friction_rate) : null,
      }),
    );

    const docTypeMetrics: DocTypeMetricRow[] = (docTypeResult.data ?? []).map(
      (r: any) => ({
        doc_type: r.doc_type ?? "unknown",
        engine_version: r.engine_version ?? null,
        auto_attached: Number(r.auto_attached ?? 0),
        routed_to_review: Number(r.routed_to_review ?? 0),
        no_match: Number(r.no_match ?? 0),
        total_match_events: Number(r.total_match_events ?? 0),
        override_count: Number(r.override_count ?? 0),
        auto_attach_rate:
          r.auto_attach_rate != null ? Number(r.auto_attach_rate) : null,
        override_rate:
          r.override_rate != null ? Number(r.override_rate) : null,
      }),
    );

    const confidenceDistribution: ConfidenceBucket[] = (
      confResult.data ?? []
    ).map((r: any) => ({
      confidence_bucket: r.confidence_bucket ?? "unknown",
      classification_tier: r.classification_tier ?? null,
      schema_version: r.schema_version ?? null,
      event_count: Number(r.event_count ?? 0),
    }));

    return NextResponse.json({
      ok: true,
      slotMetrics,
      docTypeMetrics,
      confidenceDistribution,
    });
  } catch (e: any) {
    console.error("[atomic-metrics] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
