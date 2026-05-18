// SPEC-ROUTE-CONSOLIDATION-1: Single [action] dispatcher for /api/deals/[dealId]/model-v2/*
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Ctx = { params: Promise<{ dealId: string; action: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { action } = await ctx.params;
  // Pass original ctx so handlers can read dealId
  switch (action) {
    case "drift":
      return (await import("./_handlers/drift")).GET(req, ctx as any);
    case "parity":
      return (await import("./_handlers/parity")).GET(req, ctx as any);
    case "preview":
      return (await import("./_handlers/preview")).GET(req, ctx as any);
    case "render-diff":
      return (await import("./_handlers/render-diff")).GET(req, ctx as any);
    case "replay":
      return (await import("./_handlers/replay")).GET(req, ctx as any);
    case "upgrade-preview":
      return (await import("./_handlers/upgrade-preview")).GET(req, ctx as any);
    default:
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { action } = await ctx.params;
  switch (action) {
    case "kick":
      return (await import("./_handlers/kick")).POST(req, ctx as any);
    default:
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
}
