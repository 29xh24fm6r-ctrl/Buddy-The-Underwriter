import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FunnelRow = {
  day: string;
  uploaded: number;
  classified: number;
  gate_held: number;
  confirmed: number;
  submitted: number;
  median_upload_to_classify_s: number | null;
  median_classify_to_confirm_s: number | null;
};

// ---------------------------------------------------------------------------
// GET /api/ops/intake/funnel
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
      .from("intake_funnel_daily_v1")
      .select("*")
      .order("day", { ascending: false })
      .limit(60);

    if (error) {
      console.warn("[ops/intake/funnel] query error (non-fatal):", error);
    }

    const funnel: FunnelRow[] = (data ?? []).map((r: any) => ({
      day: r.day ?? "",
      uploaded: Number(r.uploaded ?? 0),
      classified: Number(r.classified ?? 0),
      gate_held: Number(r.gate_held ?? 0),
      confirmed: Number(r.confirmed ?? 0),
      submitted: Number(r.submitted ?? 0),
      median_upload_to_classify_s:
        r.median_upload_to_classify_s != null
          ? Number(r.median_upload_to_classify_s)
          : null,
      median_classify_to_confirm_s:
        r.median_classify_to_confirm_s != null
          ? Number(r.median_classify_to_confirm_s)
          : null,
    }));

    return NextResponse.json({ ok: true, funnel });
  } catch (e: any) {
    console.error("[ops/intake/funnel] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
