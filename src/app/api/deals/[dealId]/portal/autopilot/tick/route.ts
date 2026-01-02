// src/app/api/deals/[dealId]/portal/autopilot/tick/route.ts
import { NextResponse } from "next/server";
import { runPortalAutopilotForDeal } from "@/lib/portal/autopilot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  const result = await runPortalAutopilotForDeal(dealId);
  return NextResponse.json(result);
}
