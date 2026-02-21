import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SegmentationDailyRow = {
  day: string;
  detected: number;
  physically_split: number;
  detected_not_split: number;
  total_children_created: number;
  avg_segments_per_doc: number | null;
};

// ---------------------------------------------------------------------------
// GET /api/ops/intake/segmentation
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

    const { data, error } = await (sb as any)
      .from("intake_segmentation_daily_v1")
      .select("*")
      .order("day", { ascending: false })
      .limit(60);

    if (error) {
      console.warn("[ops/intake/segmentation] query error (non-fatal):", error);
    }

    const segmentation: SegmentationDailyRow[] = (data ?? []).map((r: any) => ({
      day: r.day ?? "",
      detected: Number(r.detected ?? 0),
      physically_split: Number(r.physically_split ?? 0),
      detected_not_split: Number(r.detected_not_split ?? 0),
      total_children_created: Number(r.total_children_created ?? 0),
      avg_segments_per_doc:
        r.avg_segments_per_doc != null
          ? Number(r.avg_segments_per_doc)
          : null,
    }));

    return NextResponse.json({ ok: true, segmentation });
  } catch (e: any) {
    console.error("[ops/intake/segmentation] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
