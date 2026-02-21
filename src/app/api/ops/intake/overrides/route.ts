import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type OverrideDailyRow = {
  day: string;
  override_source: string;
  override_count: number;
  avg_confidence_at_time: number | null;
  dominant_classifier_source: string | null;
};

type OverridePatternRow = {
  from_type: string | null;
  to_type: string | null;
  override_source: string;
  pattern_count: number;
  avg_confidence: number | null;
  dominant_classifier: string | null;
  first_seen: string | null;
  last_seen: string | null;
};

// ---------------------------------------------------------------------------
// GET /api/ops/intake/overrides
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

    const [dailyRes, patternsRes] = await Promise.all([
      (sb as any)
        .from("override_intel_daily_v1")
        .select("*")
        .order("day", { ascending: false })
        .limit(120),
      (sb as any)
        .from("override_top_patterns_v1")
        .select("*")
        .order("pattern_count", { ascending: false })
        .limit(50),
    ]);

    if (dailyRes.error) {
      console.warn("[ops/intake/overrides] daily query error (non-fatal):", dailyRes.error);
    }
    if (patternsRes.error) {
      console.warn("[ops/intake/overrides] patterns query error (non-fatal):", patternsRes.error);
    }

    const daily: OverrideDailyRow[] = (dailyRes.data ?? []).map((r: any) => ({
      day: r.day ?? "",
      override_source: r.override_source ?? "unknown",
      override_count: Number(r.override_count ?? 0),
      avg_confidence_at_time:
        r.avg_confidence_at_time != null ? Number(r.avg_confidence_at_time) : null,
      dominant_classifier_source: r.dominant_classifier_source ?? null,
    }));

    const topPatterns: OverridePatternRow[] = (patternsRes.data ?? []).map((r: any) => ({
      from_type: r.from_type ?? null,
      to_type: r.to_type ?? null,
      override_source: r.override_source ?? "unknown",
      pattern_count: Number(r.pattern_count ?? 0),
      avg_confidence: r.avg_confidence != null ? Number(r.avg_confidence) : null,
      dominant_classifier: r.dominant_classifier ?? null,
      first_seen: r.first_seen ?? null,
      last_seen: r.last_seen ?? null,
    }));

    return NextResponse.json({ ok: true, daily, topPatterns });
  } catch (e: any) {
    console.error("[ops/intake/overrides] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
