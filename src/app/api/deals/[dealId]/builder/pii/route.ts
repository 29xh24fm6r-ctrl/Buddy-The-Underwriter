import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { storeSecurePii, getPiiStatus } from "@/lib/builder/secure/securePiiIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

/**
 * POST /api/deals/[dealId]/builder/pii
 * Store encrypted SSN/TIN. Returns only last4.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const body = await req.json().catch(() => ({}));
  if (!body.piiType || !body.plaintext) {
    return NextResponse.json({ ok: false, error: "piiType and plaintext required" }, { status: 400 });
  }

  const result = await storeSecurePii({
    dealId,
    bankId: auth.bankId,
    ownershipEntityId: body.ownershipEntityId ?? null,
    piiType: body.piiType,
    plaintext: body.plaintext,
    actorUserId: auth.userId,
  });

  if (!result.ok) return NextResponse.json(result, { status: 400 });
  return NextResponse.json({ ok: true, last4: result.last4 });
}
