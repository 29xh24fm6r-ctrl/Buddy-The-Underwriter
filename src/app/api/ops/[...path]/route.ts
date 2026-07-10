// SPEC-ROUTE-CONSOLIDATION-1: Catch-all dispatcher for /api/ops/*
// Replaces 15 individual route.ts files. Handler logic preserved identically.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ path: string[] }> };

const NOT_FOUND = () =>
  NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const route = path.join("/");
  switch (route) {
    case "agent-runs":
      return (await import("./_handlers/agent-runs")).GET(req);
    case "buddy-status":
      return (await import("./_handlers/buddy-status")).GET(req);
    case "deal-timeline":
      return (await import("./_handlers/deal-timeline")).GET(req);
    case "intake/funnel":
      return (await import("./_handlers/intake-funnel")).GET(req);
    case "intake/golden-stubs":
      return (await import("./_handlers/intake-golden-stubs")).GET(req);
    case "intake/overrides":
      return (await import("./_handlers/intake-overrides")).GET(req);
    case "intake/quality":
      return (await import("./_handlers/intake-quality")).GET(req);
    case "intake/segmentation":
      return (await import("./_handlers/intake-segmentation")).GET(req);
    case "intake/summary":
      return (await import("./_handlers/intake-summary")).GET(req);
    case "observer/tick":
      return (await import("./_handlers/observer-tick")).GET(req);
    default:
      // agent-runs/<runId> pattern
      if (path.length === 2 && path[0] === "agent-runs") {
        const fakeCtx = { params: Promise.resolve({ runId: path[1] }) };
        return (await import("./_handlers/agent-runs-runId")).GET(req, fakeCtx as any);
      }
      return NOT_FOUND();
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const route = path.join("/");
  switch (route) {
    case "cleanup-spread-orphans":
      return (await import("./_handlers/cleanup-spread-orphans")).POST(req);
    case "mark-dead":
      return (await import("./_handlers/mark-dead")).POST(req);
    case "replay-deal":
      return (await import("./_handlers/replay-deal")).POST(req);
    case "retry-job":
      return (await import("./_handlers/retry-job")).POST(req);
    case "worker-auth/probe":
      return (await import("./_handlers/worker-auth-probe")).POST(req);
    case "observer/tick":
      return (await import("./_handlers/observer-tick")).POST(req);
    default:
      return NOT_FOUND();
  }
}
