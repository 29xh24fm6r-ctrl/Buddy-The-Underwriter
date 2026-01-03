import { NextRequest } from "next/server";
import { GET as commandGET } from "../route";

/**
 * Alias endpoint:
 * GET /api/deals/[dealId]/command/latest
 * forwards to /api/deals/[dealId]/command
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: any) {
  return commandGET(req, ctx);
}
