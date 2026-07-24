import { NextRequest, NextResponse } from "next/server";
import { requireDealCockpitAccess, COCKPIT_ROLES } from "@/lib/auth/requireDealCockpitAccess";
import { storeSecurePii, getPiiStatus, type PiiType } from "@/lib/builder/secure/securePiiIntake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ dealId: string }> };

const VALID_PII_TYPES: PiiType[] = ["full_ssn", "full_tin", "spouse_full_ssn"];

/**
 * GET /api/deals/[dealId]/builder/pii?ownershipEntityId=...
 * Presence + last4 only — never the decrypted value. Backs the builder
 * UI's "SSN on file" status so it never has to guess or re-request data
 * that's already captured.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { dealId } = await ctx.params;
  const auth = await requireDealCockpitAccess(dealId, COCKPIT_ROLES);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const ownershipEntityId = req.nextUrl.searchParams.get("ownershipEntityId");
  if (!ownershipEntityId) {
    return NextResponse.json({ ok: false, error: "ownershipEntityId required" }, { status: 400 });
  }

  const status = await getPiiStatus(dealId, ownershipEntityId);
  return NextResponse.json({ ok: true, ...status });
}

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
  if (!VALID_PII_TYPES.includes(body.piiType)) {
    return NextResponse.json({ ok: false, error: `piiType must be one of ${VALID_PII_TYPES.join(", ")}` }, { status: 400 });
  }
  if (!body.ownershipEntityId) {
    return NextResponse.json({ ok: false, error: "ownershipEntityId required" }, { status: 400 });
  }

  const result = await storeSecurePii({
    dealId,
    bankId: auth.bankId,
    ownershipEntityId: body.ownershipEntityId,
    piiType: body.piiType,
    plaintext: body.plaintext,
    actorUserId: auth.userId,
  });

  if (!result.ok) {
    // Server misconfiguration (missing encryption key), not a client input
    // error — surface as 5xx so it isn't confused with a validation failure.
    const status = result.errorCode === "encryption_not_configured" ? 500 : 400;
    return NextResponse.json(result, { status });
  }
  return NextResponse.json({ ok: true, last4: result.last4 });
}
