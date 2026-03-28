import "server-only";

import { NextResponse } from "next/server";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { sendBorrowerCampaign } from "@/core/borrower-orchestration/sendBorrowerCampaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; campaignId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  const { dealId, campaignId } = await ctx.params;
  const access = await ensureDealBankAccess(dealId);
  if (!access.ok) {
    return NextResponse.json({ ok: false, error: access.error }, { status: 403 });
  }

  const result = await sendBorrowerCampaign({
    campaignId,
    dealId,
    bankId: access.bankId,
  });

  return NextResponse.json(result);
}
