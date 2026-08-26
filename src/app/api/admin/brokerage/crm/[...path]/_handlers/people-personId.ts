import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { getPerson, updatePerson, linkPersonToOrganization, unlinkPersonFromOrganization } from "@/lib/crm/people";
import { resolvePersonRelationships } from "@/lib/crm/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/brokerage/crm/people/[personId] — one person's detail: their
 * organization roles (a person may have several — that's the whole point
 * of PR1), their deal roles, and their activity timeline.
 *
 * POST links this person to an organization; DELETE (?roleId=) soft-unlinks
 * — folded in here rather than a separate link-organization route (route-
 * budget consolidation; see routeConsolidationGuard test).
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
  { params }: { params: Promise<{ personId: string }> },
) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const { personId } = await params;
  const brokerageBankId = await getBrokerageBankId();

  const person = await getPerson(brokerageBankId, personId);
  if (!person) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const relationships = await resolvePersonRelationships(brokerageBankId, personId);

  return NextResponse.json({ ok: true, person, ...relationships });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ personId: string }> },
) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const { personId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  try {
    const person = await updatePerson(brokerageBankId, personId, {
      firstName: body?.firstName,
      lastName: body?.lastName,
      preferredName: body?.preferredName,
      email: body?.email,
      phone: body?.phone,
      mobilePhone: body?.mobilePhone,
      jobTitle: body?.jobTitle,
      linkedinUrl: body?.linkedinUrl,
      communicationPreference: body?.communicationPreference,
      relationshipOwnerClerkUserId: body?.relationshipOwnerClerkUserId,
      notes: body?.notes,
      contactStatus: body?.contactStatus,
      doNotContact: body?.doNotContact,
    });
    return NextResponse.json({ ok: true, person });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/admin/brokerage/crm/people/[personId] — links this person to an
 * organization under a role, the core "one person, many organizations"
 * operation PR1 exists to support. (Distinguished from the plain detail GET
 * by requiring a body with organizationId.)
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ personId: string }> },
) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const { personId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  if (typeof body?.organizationId !== "string" || !body.organizationId) {
    return NextResponse.json({ ok: false, error: "organizationId is required" }, { status: 400 });
  }

  try {
    const role = await linkPersonToOrganization({
      bankId: brokerageBankId,
      personId,
      organizationId: body.organizationId,
      role: body?.role,
      jobTitle: body?.jobTitle ?? null,
      startDate: body?.startDate ?? null,
      isPrimaryContact: !!body?.isPrimaryContact,
      isDecisionMaker: !!body?.isDecisionMaker,
    });
    return NextResponse.json({ ok: true, role });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/brokerage/crm/people/[personId]?roleId=...
 * Soft-unlinks (is_active=false, end_date set) — never deletes the row,
 * preserving "when were they there" history.
 */
export async function DELETE(req: NextRequest) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const brokerageBankId = await getBrokerageBankId();
  const roleId = req.nextUrl.searchParams.get("roleId");
  if (!roleId) {
    return NextResponse.json({ ok: false, error: "roleId is required" }, { status: 400 });
  }

  try {
    await unlinkPersonFromOrganization(brokerageBankId, roleId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
