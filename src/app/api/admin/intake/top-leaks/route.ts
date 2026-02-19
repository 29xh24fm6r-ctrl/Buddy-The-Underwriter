import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type SlotOverrideRow = {
  slot_key: string;
  slot_id: string | null;
  effective_doc_type: string | null;
  required_doc_type: string | null;
  engine_version: string | null;
  auto_attached: number;
  routed_to_review: number;
  total_attempts: number;
  precision_rate: number | null;
  friction_rate: number | null;
  override_count: number;
  override_rate: number;
};

type SlotReviewRow = {
  slot_key: string;
  slot_id: string | null;
  effective_doc_type: string | null;
  required_doc_type: string | null;
  engine_version: string | null;
  routed_to_review: number;
  total_attempts: number;
  review_rate: number | null;
};

type DocTypeReviewRow = {
  doc_type: string;
  engine_version: string | null;
  total_match_events: number;
  routed_to_review: number;
  review_rate: number | null;
};

type RegressionRow = {
  doc_type: string;
  engine_version: string;
  auto_attach_rate: number | null;
  prior_attach_rate: number | null;
  delta: number | null;
};

type AnomalyRow = {
  doc_type: string;
  engine_version: string | null;
  avg_confidence: number | null;
  sample_count: number;
  auto_attach_rate: number | null;
};

type TopLeaksResponse =
  | {
      ok: true;
      topSlotOverrides: SlotOverrideRow[];
      topSlotReview: SlotReviewRow[];
      topDocTypeReview: DocTypeReviewRow[];
      engineRegression: RegressionRow[];
      confidenceAnomalies: AnomalyRow[];
    }
  | {
      ok: false;
      error: string;
    };

// ---------------------------------------------------------------------------
// GET /api/admin/intake/top-leaks
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
): Promise<NextResponse<TopLeaksResponse>> {
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

    const [
      slotOverridesResult,
      slotReviewResult,
      docTypeReviewResult,
      regressionResult,
      anomalyResult,
    ] = await Promise.all([
      sb.from("intake_top_slot_overrides_v1").select("*"),
      sb.from("intake_top_slot_review_v1").select("*"),
      sb.from("intake_top_doc_type_review_v1").select("*"),
      sb.from("intake_engine_regression_v1").select("*"),
      sb.from("intake_confidence_anomalies_v1").select("*"),
    ]);

    if (slotOverridesResult.error) {
      console.error("[top-leaks] slot overrides error:", slotOverridesResult.error);
      return NextResponse.json(
        { ok: false, error: slotOverridesResult.error.message },
        { status: 500 },
      );
    }
    if (slotReviewResult.error) {
      console.error("[top-leaks] slot review error:", slotReviewResult.error);
      return NextResponse.json(
        { ok: false, error: slotReviewResult.error.message },
        { status: 500 },
      );
    }
    if (docTypeReviewResult.error) {
      console.error("[top-leaks] doc type review error:", docTypeReviewResult.error);
      return NextResponse.json(
        { ok: false, error: docTypeReviewResult.error.message },
        { status: 500 },
      );
    }
    if (regressionResult.error) {
      console.error("[top-leaks] regression error:", regressionResult.error);
      return NextResponse.json(
        { ok: false, error: regressionResult.error.message },
        { status: 500 },
      );
    }
    if (anomalyResult.error) {
      console.error("[top-leaks] anomaly error:", anomalyResult.error);
      return NextResponse.json(
        { ok: false, error: anomalyResult.error.message },
        { status: 500 },
      );
    }

    const topSlotOverrides: SlotOverrideRow[] = (slotOverridesResult.data ?? []).map(
      (r: any) => ({
        slot_key: r.slot_key ?? "unknown",
        slot_id: r.slot_id ?? null,
        effective_doc_type: r.effective_doc_type ?? null,
        required_doc_type: r.required_doc_type ?? null,
        engine_version: r.engine_version ?? null,
        auto_attached: Number(r.auto_attached ?? 0),
        routed_to_review: Number(r.routed_to_review ?? 0),
        total_attempts: Number(r.total_attempts ?? 0),
        precision_rate: r.precision_rate != null ? Number(r.precision_rate) : null,
        friction_rate: r.friction_rate != null ? Number(r.friction_rate) : null,
        override_count: Number(r.override_count ?? 0),
        override_rate: Number(r.override_rate ?? 0),
      }),
    );

    const topSlotReview: SlotReviewRow[] = (slotReviewResult.data ?? []).map(
      (r: any) => ({
        slot_key: r.slot_key ?? "unknown",
        slot_id: r.slot_id ?? null,
        effective_doc_type: r.effective_doc_type ?? null,
        required_doc_type: r.required_doc_type ?? null,
        engine_version: r.engine_version ?? null,
        routed_to_review: Number(r.routed_to_review ?? 0),
        total_attempts: Number(r.total_attempts ?? 0),
        review_rate: r.review_rate != null ? Number(r.review_rate) : null,
      }),
    );

    const topDocTypeReview: DocTypeReviewRow[] = (docTypeReviewResult.data ?? []).map(
      (r: any) => ({
        doc_type: r.doc_type ?? "unknown",
        engine_version: r.engine_version ?? null,
        total_match_events: Number(r.total_match_events ?? 0),
        routed_to_review: Number(r.routed_to_review ?? 0),
        review_rate: r.review_rate != null ? Number(r.review_rate) : null,
      }),
    );

    const engineRegression: RegressionRow[] = (regressionResult.data ?? []).map(
      (r: any) => ({
        doc_type: r.doc_type ?? "unknown",
        engine_version: r.engine_version ?? "",
        auto_attach_rate: r.auto_attach_rate != null ? Number(r.auto_attach_rate) : null,
        prior_attach_rate: r.prior_attach_rate != null ? Number(r.prior_attach_rate) : null,
        delta: r.delta != null ? Number(r.delta) : null,
      }),
    );

    const confidenceAnomalies: AnomalyRow[] = (anomalyResult.data ?? []).map(
      (r: any) => ({
        doc_type: r.doc_type ?? "unknown",
        engine_version: r.engine_version ?? null,
        avg_confidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
        sample_count: Number(r.sample_count ?? 0),
        auto_attach_rate: r.auto_attach_rate != null ? Number(r.auto_attach_rate) : null,
      }),
    );

    return NextResponse.json({
      ok: true,
      topSlotOverrides,
      topSlotReview,
      topDocTypeReview,
      engineRegression,
      confidenceAnomalies,
    });
  } catch (e: any) {
    console.error("[top-leaks] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
