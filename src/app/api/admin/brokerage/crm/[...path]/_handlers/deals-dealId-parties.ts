import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { linkPartyToDeal, listPartyRolesForDeal, DEAL_PARTY_ROLES } from "@/lib/crm/partyRoles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/brokerage/crm/deals/[dealId]/parties
 *
 * External parties (referral sources, CPAs, attorneys, title companies,
 * etc.) attached to a deal -- NOT borrower/owner/guarantor (ownership_entities)
 * or internal staff (deal_participants), which stay on their existing
 * authoritative tables. See deal_party_roles migration header.
 */

async function gate(): Promise<{ userId: string } | NextResponse> {
  try {
    return await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const { dealId } = await params;
  const brokerageBankId = await getBrokerageBankId();

  try {
    const parties = await listPartyRolesForDeal(brokerageBankId, dealId);
    return NextResponse.json({ ok: true, parties });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ dealId: string }> },
) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;
  const { userId } = gated;

  const { dealId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  if (!DEAL_PARTY_ROLES.includes(body?.role)) {
    return NextResponse.json({ ok: false, error: `role must be one of: ${DEAL_PARTY_ROLES.join(", ")}` }, { status: 400 });
  }

  try {
    const party = await linkPartyToDeal({
      bankId: brokerageBankId,
      dealId,
      role: body.role,
      personId: typeof body?.personId === "string" ? body.personId : null,
      organizationId: typeof body?.organizationId === "string" ? body.organizationId : null,
      notes: body?.notes ?? null,
      createdByClerkUserId: userId,
    });
    return NextResponse.json({ ok: true, party });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
