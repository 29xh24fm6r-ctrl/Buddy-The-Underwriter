// SPEC-ROUTE-CONSOLIDATION-1: Catch-all for internal tooling routes
// Consolidates: build-meta, evals/*, omega/*
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
    case "build-meta":
      return (await import("./_handlers/build-meta")).GET();
    case "evals/results":
      return (await import("./_handlers/evals-results")).GET();
    default:
      return NOT_FOUND();
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const route = path.join("/");
  switch (route) {
    case "evals/run":
      return (await import("./_handlers/evals-run")).POST(req);
    case "omega/portfolio":
      return (await import("./_handlers/omega-portfolio")).POST(req);
    case "omega/relationship":
      return (await import("./_handlers/omega-relationship")).POST(req);
    default:
      return NOT_FOUND();
  }
}
