import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type QualityRow = {
  day: string;
  total_docs: number;
  passed: number;
  failed_low_text: number;
  failed_low_confidence: number;
  failed_ocr_error: number;
  not_evaluated: number;
  pass_rate: number | null;
};

// ---------------------------------------------------------------------------
// GET /api/ops/intake/quality
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
      .from("intake_quality_daily_v1")
      .select("*")
      .order("day", { ascending: false })
      .limit(60);

    if (error) {
      console.warn("[ops/intake/quality] query error (non-fatal):", error);
    }

    const quality: QualityRow[] = (data ?? []).map((r: any) => ({
      day: r.day ?? "",
      total_docs: Number(r.total_docs ?? 0),
      passed: Number(r.passed ?? 0),
      failed_low_text: Number(r.failed_low_text ?? 0),
      failed_low_confidence: Number(r.failed_low_confidence ?? 0),
      failed_ocr_error: Number(r.failed_ocr_error ?? 0),
      not_evaluated: Number(r.not_evaluated ?? 0),
      pass_rate: r.pass_rate != null ? Number(r.pass_rate) : null,
    }));

    return NextResponse.json({ ok: true, quality });
  } catch (e: any) {
    console.error("[ops/intake/quality] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
