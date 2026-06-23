import "server-only";
import { NextRequest, NextResponse } from "next/server";

import { GET as qualityGET } from "./quality";

export const runtime = "nodejs";
export const maxDuration = 10;

type Params = Promise<{ dealId: string }>;

/**
 * GET /api/deals/[dealId]/research/committee-transition-preview
 * SPEC-BIE-COMMITTEE-READINESS-FINALIZATION-MEGA-1 — Phase 2 (optional, read-only)
 *
 * Consolidated dispatcher handler (no new serverless function). Reuses the
 * quality read-path (which already computes the impact preview + transition
 * result with NO mutation) and returns just those two fields. Purely read-only:
 * never writes the gate, tasks, or any state.
 */
export async function GET(req: NextRequest, ctx: { params: Params }) {
  try {
    const res = await qualityGET(req, ctx);
    const data = (await res.json()) as Record<string, unknown>;
    if (!data?.ok) {
      return NextResponse.json({ ok: false, error: data?.error ?? "quality_unavailable" }, { status: res.status });
    }
    return NextResponse.json({
      ok: true,
      impact_preview: data.committee_blocker_impact_preview ?? null,
      transition_result: data.committee_transition_result ?? null,
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "unexpected_error" },
      { status: 500 },
    );
  }
}
