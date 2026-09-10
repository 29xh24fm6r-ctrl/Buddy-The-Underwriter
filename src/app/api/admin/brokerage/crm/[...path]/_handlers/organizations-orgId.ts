import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { canDeleteBrokerageCrmRecords, requireBrokerageAdmin, requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { updateOrganization, ORGANIZATION_TYPES } from "@/lib/crm/organizations";
import { listPeopleForOrganization } from "@/lib/crm/people";
import { resolveDealRolesForOrganization } from "@/lib/crm/resolve";
import { bankBuyerGET, bankBuyerPATCH, bankBuyerPOST } from "@/lib/crm/bankBuyerRoute";
import { beginCrmDeletion, confirmationMatches, finishCrmDeletion } from "@/lib/crm/adminDeletion";

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
  const { orgId } = await params;
  if (orgId === "buyers") return bankBuyerGET();

  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

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

  const { data: lenderProfile, error: lenderProfileErr } = await sb
    .from("crm_lender_profiles")
    .select("*")
    .eq("bank_id", brokerageBankId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (lenderProfileErr) {
    return NextResponse.json({ ok: false, error: lenderProfileErr.message }, { status: 500 });
  }

  let lenderSubmissions: any[] = [];
  if (lenderProfile) {
    const { data: submissions, error: submissionsErr } = await sb
      .from("crm_deal_lender_submissions")
      .select("*")
      .eq("bank_id", brokerageBankId)
      .eq("lender_profile_id", lenderProfile.id)
      .order("updated_at", { ascending: false });
    if (submissionsErr) {
      return NextResponse.json({ ok: false, error: submissionsErr.message }, { status: 500 });
    }
    const dealIds = (submissions ?? []).map((row: any) => row.deal_id);
    const { data: submissionDeals, error: submissionDealsErr } = dealIds.length
      ? await sb.from("deals").select("id, display_name, borrower_name, name, loan_amount").eq("bank_id", brokerageBankId).in("id", dealIds)
      : { data: [], error: null };
    if (submissionDealsErr) {
      return NextResponse.json({ ok: false, error: submissionDealsErr.message }, { status: 500 });
    }
    const dealById = new Map((submissionDeals ?? []).map((deal: any) => [deal.id, deal]));
    lenderSubmissions = (submissions ?? []).map((row: any) => ({ ...row, deal: dealById.get(row.deal_id) ?? null }));
  }

  return NextResponse.json({
    ok: true,
    permissions: { canDelete: await canDeleteBrokerageCrmRecords() },
    organization: org,
    people: people ?? [],
    peopleWithRoles,
    dealPartyRoles,
    activities: activities ?? [],
    referredDeals: referredDeals ?? [],
    leads: leads ?? [],
    lenderProfile: lenderProfile ?? null,
    lenderSubmissions,
  });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  let actorUserId: string;
  try {
    ({ userId: actorUserId } = await requireBrokerageAdmin());
  } catch {
    return NextResponse.json({ ok: false, error: "admin_required" }, { status: 403 });
  }

  const { orgId } = await params;
  if (orgId === "buyers") return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  const bankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const { data: organization, error: organizationError } = await sb
    .from("crm_organizations").select("*").eq("id", orgId).eq("bank_id", bankId).maybeSingle();
  if (organizationError) return NextResponse.json({ ok: false, error: organizationError.message }, { status: 500 });
  if (!organization) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => ({})) as { confirmation?: unknown };
  if (!confirmationMatches(body?.confirmation, organization.name)) {
    return NextResponse.json({ ok: false, error: "confirmation_mismatch" }, { status: 400 });
  }

  const [referredDealsResult, referredLeadsResult, partyRolesResult, lenderProfileResult] = await Promise.all([
    sb.from("deals").select("id").eq("bank_id", bankId).eq("referral_source_org_id", orgId).limit(1),
    sb.from("brokerage_leads").select("id").eq("bank_id", bankId).eq("referral_source_org_id", orgId).limit(1),
    sb.from("deal_party_roles").select("id").eq("bank_id", bankId).eq("organization_id", orgId).limit(1),
    sb.from("crm_lender_profiles").select("id").eq("bank_id", bankId).eq("organization_id", orgId).maybeSingle(),
  ]);
  const preflightError = [referredDealsResult.error, referredLeadsResult.error, partyRolesResult.error, lenderProfileResult.error].find(Boolean);
  if (preflightError) return NextResponse.json({ ok: false, error: "delete_preflight_failed" }, { status: 500 });
  const lenderSubmissionsResult = lenderProfileResult.data
    ? await sb.from("crm_deal_lender_submissions").select("id").eq("bank_id", bankId).eq("lender_profile_id", lenderProfileResult.data.id).limit(1)
    : { data: [], error: null };
  if (lenderSubmissionsResult.error) return NextResponse.json({ ok: false, error: "delete_preflight_failed" }, { status: 500 });
  const blockers = [
    referredDealsResult.data?.length ? "a referred deal" : null,
    referredLeadsResult.data?.length ? "a referred lead" : null,
    partyRolesResult.data?.length ? "a deal-party role" : null,
    lenderSubmissionsResult.data?.length ? "a lender placement" : null,
  ].filter(Boolean);
  if (blockers.length) {
    return NextResponse.json({ ok: false, error: "record_in_use", blockers }, { status: 409 });
  }

  let auditId: string;
  try {
    auditId = await beginCrmDeletion({ sb, bankId, actorUserId, entityType: "organization", entityId: orgId, entityLabel: organization.name, snapshot: organization });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "deletion_audit_failed" }, { status: 500 });
  }
  const { data: deleted, error: deleteError } = await sb.from("crm_organizations").delete().eq("id", orgId).eq("bank_id", bankId).select("id").maybeSingle();
  const finalDeleteError = deleteError ?? (!deleted ? new Error("delete_not_confirmed") : null);
  await finishCrmDeletion(sb, auditId, finalDeleteError ? { ok: false, reason: finalDeleteError.message } : { ok: true });
  if (finalDeleteError) return NextResponse.json({ ok: false, error: finalDeleteError.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  if (orgId === "buyers") return bankBuyerPATCH(req);

  const gated = await gate();
  if (gated instanceof NextResponse) return gated;

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
      tags: body?.tags,
      relationshipTier: body?.relationshipTier,
      ownerClerkUserId: body?.ownerClerkUserId,
      howWeMet: body?.howWeMet,
      customFields: body?.customFields,
    });
    return NextResponse.json({ ok: true, organization });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}


export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ orgId: string }> },
) {
  const { orgId } = await params;
  if (orgId === "buyers") return bankBuyerPOST(req);
  return NextResponse.json({ ok: false, error: "method_not_allowed" }, { status: 405 });
}
