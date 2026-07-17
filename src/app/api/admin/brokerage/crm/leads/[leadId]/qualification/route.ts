import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { getQualification, upsertQualification, QUALIFICATION_FIELDS, PROVENANCE_STATES } from "@/lib/leads/qualification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  try {
    await requireBrokerageStaff();
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { leadId } = await params;
  const brokerageBankId = await getBrokerageBankId();

  try {
    const qualification = await getQualification(brokerageBankId, leadId);
    return NextResponse.json({ ok: true, qualification });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}

/**
 * PUT /api/admin/brokerage/crm/leads/[leadId]/qualification
 * Body: { fields: {...}, provenance?: {...} }
 *
 * Provenance defaults to "unknown" for any field left unset — borrower-
 * stated numbers are never silently treated as verified.
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ leadId: string }> },
) {
  let userId: string;
  try {
    ({ userId } = await requireBrokerageStaff());
  } catch {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { leadId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  const fields: Record<string, unknown> = {};
  for (const key of QUALIFICATION_FIELDS) {
    if (body?.fields && key in body.fields) fields[key] = body.fields[key];
  }

  let provenance: Record<string, string> | undefined;
  if (body?.provenance && typeof body.provenance === "object") {
    provenance = {};
    for (const [key, value] of Object.entries(body.provenance)) {
      if ((QUALIFICATION_FIELDS as readonly string[]).includes(key) && (PROVENANCE_STATES as readonly string[]).includes(value as string)) {
        provenance[key] = value as string;
      }
    }
  }

  try {
    const qualification = await upsertQualification({
      bankId: brokerageBankId,
      leadId,
      createdByClerkUserId: userId,
      fields,
      provenance: provenance as any,
    });
    return NextResponse.json({ ok: true, qualification });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
