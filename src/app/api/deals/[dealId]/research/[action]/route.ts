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
    default:
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { action } = await ctx.params;
  switch (action) {
    case "run":
      return (await import("./_handlers/run")).POST(req, ctx as any);
    default:
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
}
