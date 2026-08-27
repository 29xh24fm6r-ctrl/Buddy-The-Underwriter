// Buddy reminder-incident route-capacity consolidation.
// Historical URLs and handler implementations are preserved; only the App
// Router filesystem topology changes.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

const ROUTES = new Set([
  "ack",
  "action",
  "assign",
  "escalate/tick",
  "meta",
  "notes",
  "postmortem",
  "sync",
]);

async function dispatch(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  const route = path.join("/");
  if (!ROUTES.has(route)) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  switch (route) {
    case "ack":
      return (await import("./_handlers/ack")).POST(req);
    case "action":
      return (await import("./_handlers/action")).POST(req);
    case "assign":
      return (await import("./_handlers/assign")).POST(req);
    case "escalate/tick":
      return (await import("./_handlers/escalate-tick")).POST(req);
    case "meta":
      return (await import("./_handlers/meta")).POST(req);
    case "notes":
      return (await import("./_handlers/notes")).POST(req);
    case "postmortem":
      return (await import("./_handlers/postmortem")).POST(req);
    case "sync":
      return (await import("./_handlers/sync")).POST(req);
    default:
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  return dispatch(req, ctx);
}
