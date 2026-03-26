import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { applyCreditActionRecommendation } from "@/lib/creditActioning/applyCreditActionRecommendation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string; actionId: string }> };

const VALID_ACTIONS = new Set(["accept", "modify", "dismiss", "convert"]);

/**
 * POST /api/deals/[dealId]/credit-actions/[actionId]
 *
 * Accept, modify, dismiss, or convert a credit action recommendation.
 * Auth: Clerk session + deal cockpit access.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { dealId, actionId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  if (!action || !VALID_ACTIONS.has(action)) {
    return NextResponse.json(
      { ok: false, error: `Invalid action. Must be one of: ${[...VALID_ACTIONS].join(", ")}` },
      { status: 400 },
    );
  }

  const result = await applyCreditActionRecommendation({
    actionId,
    dealId,
    bankId: auth.bankId,
    action: action as any,
    actorUserId: auth.userId,
    modifiedText: body.modifiedText,
    targetSystem: body.targetSystem,
    rationale: body.rationale,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    actionId: result.actionId,
    newStatus: result.newStatus,
    targetRecordId: result.targetRecordId,
  });
}
