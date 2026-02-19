import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type SegmentationMetricRow = {
  document_type: string | null;
  parent_docs_split: number;
  total_segments_created: number;
  split_failures: number;
  avg_children: number | null;
};

type SegmentationResponse =
  | {
      ok: true;
      segmentationMetrics: SegmentationMetricRow[];
    }
  | {
      ok: false;
      error: string;
    };

// ---------------------------------------------------------------------------
// GET /api/admin/intake/segmentation
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
): Promise<NextResponse<SegmentationResponse>> {
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

    const { data, error } = await (sb as any)
      .from("segmentation_metrics_v1")
      .select("*");

    // Fail-safe: if view doesn't exist or errors, return empty (never 500)
    if (error) {
      console.warn("[admin/segmentation] metrics query error (non-fatal):", error);
      return NextResponse.json({ ok: true, segmentationMetrics: [] });
    }

    const segmentationMetrics: SegmentationMetricRow[] = (data ?? []).map(
      (r: any) => ({
        document_type: r.document_type ?? null,
        parent_docs_split: Number(r.parent_docs_split ?? 0),
        total_segments_created: Number(r.total_segments_created ?? 0),
        split_failures: Number(r.split_failures ?? 0),
        avg_children:
          r.avg_children != null ? Number(r.avg_children) : null,
      }),
    );

    return NextResponse.json({ ok: true, segmentationMetrics });
  } catch (e: any) {
    console.error("[admin/segmentation] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
