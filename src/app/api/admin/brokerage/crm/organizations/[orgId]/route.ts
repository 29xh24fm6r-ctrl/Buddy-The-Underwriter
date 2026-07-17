import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { updateOrganization, ORGANIZATION_TYPES } from "@/lib/crm/organizations";
import { listPeopleForOrganization } from "@/lib/crm/people";
import { resolveDealRolesForOrganization } from "@/lib/crm/resolve";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/brokerage/crm/organizations/[orgId] — one organization's detail:
 * its people, its activity timeline (crm_activities where
 * target_organization_id = orgId, or target_person_id for any person
 * belonging to this org), and the deals it's been attributed as the
 * referral source for — the Twenty TimelineActivity pattern plus the
 * revenue-attribution piece Twenty doesn't need but a brokerage does.
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
  { params }: { params: Promise<{ orgId: string }> },
) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const { orgId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data: org, error: orgErr } = await sb
    .from("crm_organizations")
    .select("*")
    .eq("id", orgId)
    .eq("bank_id", brokerageBankId)
    .maybeSingle();

  if (orgErr) {
    return NextResponse.json({ ok: false, error: orgErr.message }, { status: 500 });
  }
  if (!org) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const { data: people, error: peopleErr } = await sb
    .from("crm_people")
    .select("*")
    .eq("bank_id", brokerageBankId)
    .eq("organization_id", orgId)
    .order("last_name", { ascending: true });

  if (peopleErr) {
    return NextResponse.json({ ok: false, error: peopleErr.message }, { status: 500 });
  }

  const personIds = (people ?? []).map((p: any) => p.id);

  const { data: activities, error: actErr } = await sb
    .from("crm_activities")
    .select("*")
    .eq("bank_id", brokerageBankId)
    .or(
      [
        `target_organization_id.eq.${orgId}`,
        personIds.length > 0 ? `target_person_id.in.(${personIds.join(",")})` : null,
      ]
        .filter(Boolean)
        .join(","),
    )
    .order("happens_at", { ascending: false })
    .limit(100);

  if (actErr) {
    return NextResponse.json({ ok: false, error: actErr.message }, { status: 500 });
  }

  const { data: referredDeals, error: dealsErr } = await sb
    .from("deals")
    .select("id, display_name, borrower_name, name, loan_amount, created_at")
    .eq("bank_id", brokerageBankId)
    .eq("referral_source_org_id", orgId)
    .order("created_at", { ascending: false });

  if (dealsErr) {
    return NextResponse.json({ ok: false, error: dealsErr.message }, { status: 500 });
  }

  const { data: leads, error: leadsErr } = await sb
    .from("brokerage_leads")
    .select("id, first_name, last_name, business_name, email, phone, loan_amount_requested, status, created_at, converted_deal_id")
    .eq("bank_id", brokerageBankId)
    .eq("referral_source_org_id", orgId)
    .order("created_at", { ascending: false });

  if (leadsErr) {
    return NextResponse.json({ ok: false, error: leadsErr.message }, { status: 500 });
  }

  const [peopleWithRoles, dealPartyRoles] = await Promise.all([
    listPeopleForOrganization(brokerageBankId, orgId),
    resolveDealRolesForOrganization(brokerageBankId, orgId),
  ]);

  return NextResponse.json({
    ok: true,
    organization: org,
    people: people ?? [],
    peopleWithRoles,
    dealPartyRoles,
    activities: activities ?? [],
    referredDeals: referredDeals ?? [],
    leads: leads ?? [],
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

  const { orgId } = await params;
  const brokerageBankId = await getBrokerageBankId();
  const body = await req.json().catch(() => ({}) as any);

  if (body?.organizationType && !ORGANIZATION_TYPES.includes(body.organizationType)) {
    return NextResponse.json({ ok: false, error: "invalid organizationType" }, { status: 400 });
  }

  try {
    const organization = await updateOrganization(brokerageBankId, orgId, {
      name: typeof body?.name === "string" ? body.name : undefined,
      organizationType: body?.organizationType,
      websiteUrl: body?.websiteUrl,
      phone: body?.phone,
      addressLine1: body?.addressLine1,
      city: body?.city,
      state: body?.state,
      postalCode: body?.postalCode,
      notes: body?.notes,
    });
    return NextResponse.json({ ok: true, organization });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
