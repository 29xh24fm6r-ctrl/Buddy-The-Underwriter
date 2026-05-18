// SPEC-ROUTE-CONSOLIDATION-1: Catch-all dispatcher for /api/workers/*
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const route = path.join("/");
  switch (route) {
    case "auth-probe":
      return (await import("./_handlers/auth-probe")).GET(req);
    case "doc-extraction":
      return (await import("./_handlers/doc-extraction")).GET(req);
    case "intake-outbox":
      return (await import("./_handlers/intake-outbox")).GET(req);
    case "intake-recovery":
      return (await import("./_handlers/intake-recovery")).GET(req);
    case "pulse-outbox":
      return (await import("./_handlers/pulse-outbox")).GET(req);
    default:
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
}
