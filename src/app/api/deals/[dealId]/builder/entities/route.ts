import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { getParticipationSummary, attachEntityToDeal } from "@/lib/builder/participation/manageParticipation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * GET /api/deals/[dealId]/builder/entities
 * Returns participation summary for the deal.
 */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const summary = await getParticipationSummary(dealId);
  return NextResponse.json({ ok: true, summary });
}

/**
 * POST /api/deals/[dealId]/builder/entities
 * Attach an entity to the deal in a specific role.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  if (!body.ownershipEntityId || !body.roleKey) {
    return NextResponse.json({ ok: false, error: "ownershipEntityId and roleKey required" }, { status: 400 });
  }

  try {
    const result = await attachEntityToDeal({
      dealId,
      ownershipEntityId: body.ownershipEntityId,
      roleKey: body.roleKey,
      isPrimary: body.isPrimary,
      ownershipPct: body.ownershipPct,
      title: body.title,
      bankId: auth.bankId,
      actorUserId: auth.userId,
    });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "Failed" }, { status: 500 });
  }
}
