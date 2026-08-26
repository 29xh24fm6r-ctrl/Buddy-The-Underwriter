import { NextRequest, NextResponse } from "next/server";
import { resolveDealApiContext } from "@/lib/server/dealApiContext";
import { generateMitigantConditionsForDeal } from "@/lib/conditions/generateMitigantConditions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ dealId: string }> },
) {
  const { dealId } = await ctx.params;
  if (!dealId) {
    return NextResponse.json(
      { ok: false, error: "missing_deal_id" },
      { status: 400 },
    );
  }

  const access = await resolveDealApiContext(dealId);
  if (!access.ok) {
    return NextResponse.json(
      { ok: false, error: access.error },
      { status: access.status },
    );
  }
  const { sb, bankId, actorProfileId } = access;

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }
  const dueDaysOverride =
    body?.due_days !== undefined ? Number(body.due_days) : null;

  const result = await generateMitigantConditionsForDeal(dealId, bankId, {
    sb: sb as any,
    createdBy: actorProfileId,
    dueDaysOverride,
  });

  return NextResponse.json({
    ok: true,
    created: result.created,
    skipped: result.skipped,
    open_mitigants: result.open_mitigants,
  });
}
