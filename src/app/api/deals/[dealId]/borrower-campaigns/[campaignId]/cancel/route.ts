import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { cancelBorrowerCampaign } from "@/core/borrower-orchestration/completeBorrowerCampaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; campaignId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { dealId, campaignId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
  }

  const result = await cancelBorrowerCampaign(campaignId);
  return NextResponse.json({ ok: result.ok, newStatus: result.newStatus });
}
