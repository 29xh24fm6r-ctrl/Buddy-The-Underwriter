import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth/requireAdmin";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

type IdentityCoverageRow = {
  doc_type: string;
  engine_version: string | null;
  total_events: number;
  resolved_count: number;
  resolution_rate: number | null;
};

type IdentityAmbiguityRow = {
  doc_type: string;
  total_events: number;
  ambiguous_count: number;
  ambiguity_rate: number | null;
};

type IdentityEnforcementRow = {
  doc_type: string;
  engine_version: string | null;
  enforcement_count: number;
};

type IdentityPrecisionRow = {
  doc_type: string;
  engine_version: string | null;
  high_confidence_events: number;
  precision_auto_attached: number;
};

type IdentityResponse =
  | {
      ok: true;
      coverage: IdentityCoverageRow[];
      ambiguityHotspots: IdentityAmbiguityRow[];
      enforcementEvents: IdentityEnforcementRow[];
      precisionMetrics: IdentityPrecisionRow[];
    }
  | {
      ok: false;
      error: string;
    };

// ---------------------------------------------------------------------------
// GET /api/admin/intake/identity
// ---------------------------------------------------------------------------

export async function GET(
  _req: NextRequest,
): Promise<NextResponse<IdentityResponse>> {
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

    const [coverageResult, ambiguityResult, enforcementResult, precisionResult] = await Promise.all([
      sb.from("identity_resolution_coverage_v1").select("*"),
      sb.from("identity_ambiguity_hotspots_v1").select("*"),
      sb.from("identity_enforcement_events_v1").select("*"),
      sb.from("identity_precision_effect_v1").select("*"),
    ]);

    if (coverageResult.error) {
      console.error("[identity] coverage query error:", coverageResult.error);
      return NextResponse.json(
        { ok: false, error: coverageResult.error.message },
        { status: 500 },
      );
    }
    if (ambiguityResult.error) {
      console.error("[identity] ambiguity query error:", ambiguityResult.error);
      return NextResponse.json(
        { ok: false, error: ambiguityResult.error.message },
        { status: 500 },
      );
    }

    const coverage: IdentityCoverageRow[] = (coverageResult.data ?? []).map(
      (r: any) => ({
        doc_type: r.doc_type ?? "unknown",
        engine_version: r.engine_version ?? null,
        total_events: Number(r.total_events ?? 0),
        resolved_count: Number(r.resolved_count ?? 0),
        resolution_rate: r.resolution_rate != null ? Number(r.resolution_rate) : null,
      }),
    );

    const ambiguityHotspots: IdentityAmbiguityRow[] = (
      ambiguityResult.data ?? []
    ).map((r: any) => ({
      doc_type: r.doc_type ?? "unknown",
      total_events: Number(r.total_events ?? 0),
      ambiguous_count: Number(r.ambiguous_count ?? 0),
      ambiguity_rate: r.ambiguity_rate != null ? Number(r.ambiguity_rate) : null,
    }));

    // Enforcement events — fail-safe empty array if view is empty or errored
    const enforcementEvents: IdentityEnforcementRow[] = enforcementResult.error
      ? []
      : (enforcementResult.data ?? []).map((r: any) => ({
          doc_type: r.doc_type ?? "unknown",
          engine_version: r.engine_version ?? null,
          enforcement_count: Number(r.enforcement_count ?? 0),
        }));

    if (enforcementResult.error) {
      console.warn("[identity] enforcement query error (non-fatal):", enforcementResult.error);
    }

    // Precision metrics — fail-safe empty array if view not yet populated or errored
    const precisionMetrics: IdentityPrecisionRow[] = precisionResult.error
      ? []
      : (precisionResult.data ?? []).map((r: any) => ({
          doc_type: r.doc_type ?? "unknown",
          engine_version: r.engine_version ?? null,
          high_confidence_events: Number(r.high_confidence_events ?? 0),
          precision_auto_attached: Number(r.precision_auto_attached ?? 0),
        }));

    if (precisionResult.error) {
      console.warn("[identity] precision query error (non-fatal):", precisionResult.error);
    }

    return NextResponse.json({
      ok: true,
      coverage,
      ambiguityHotspots,
      enforcementEvents,
      precisionMetrics,
    });
  } catch (e: any) {
    console.error("[identity] unexpected error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Internal error" },
      { status: 500 },
    );
  }
}
