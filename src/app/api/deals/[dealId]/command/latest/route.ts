import { NextRequest } from "next/server";
import { GET as commandGET } from "../route";

/**
 * Alias endpoint:
 * GET /api/deals/[dealId]/command/latest
 * forwards to /api/deals/[dealId]/command
 */
export const runtime = "nodejs";
// Spec D5: cockpit-supporting GET routes must allow headroom beyond the
// 10s default for cold-start auth + multi-step Supabase I/O.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, ctx: any) {
  return commandGET(req, ctx);
}
