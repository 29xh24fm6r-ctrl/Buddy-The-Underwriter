// SPEC-ROUTE-CONSOLIDATION-1: Single [action] dispatcher for /api/deals/[dealId]/research/*
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ dealId: string; action: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { action } = await ctx.params;
  switch (action) {
    case "diagnostics":
      return (await import("./_handlers/diagnostics")).GET(req, ctx as any);
    case "evidence":
      return (await import("./_handlers/evidence")).GET(req, ctx as any);
    case "flight-deck":
      return (await import("./_handlers/flight-deck")).GET(req, ctx as any);
    case "quality":
      return (await import("./_handlers/quality")).GET(req, ctx as any);
    // SPEC-BIE-COMMITTEE-READINESS-FINALIZATION-MEGA-1: read-only impact +
    // transition preview, consolidated here (no new serverless function).
    case "committee-transition-preview":
      return (await import("./_handlers/committeeTransitionPreview")).GET(req, ctx as any);
    default:
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { action } = await ctx.params;
  switch (action) {
    // SPEC-RESEARCH-RERUN-ACTION-DISPATCH-FIX-1: "rerun"/"re-run" are aliases for
    // "run". Stale client bundles (and the pre-consolidation UI) POST to
    // /research/rerun; route them to the same handler so a re-run starts a fresh
    // mission and returns JSON instead of 404/500. "run" behavior is unchanged.
    case "run":
    case "rerun":
    case "re-run":
      return (await import("./_handlers/run")).POST(req, ctx as any);
    // SPEC-BIE-OFFICIAL-SOURCE-CONNECTOR-FRAMEWORK-1: manual source-snapshot
    // attach, consolidated here so it adds zero net serverless functions.
    case "source-snapshot":
      return (await import("./_handlers/sourceSnapshot")).POST(req, ctx as any);
    default:
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { action } = await ctx.params;
  switch (action) {
    // SPEC-BIE-COMMITTEE-EVIDENCE-REVIEW-ACTIONS-1: committee task review action,
    // consolidated here so research/ keeps exactly one route.ts (no added function).
    case "committee-task-review":
      return (await import("./_handlers/committeeTaskReview")).PATCH(req, ctx as any);
    default:
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
}
