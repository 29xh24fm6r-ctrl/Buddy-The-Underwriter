import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["planned", "sent", "reviewing", "interested", "term_sheet", "approved", "declined", "withdrawn", "lost", "closed"]);
const TERMINAL = new Set(["declined", "withdrawn", "lost", "closed"]);
const MARKETPLACE_ROLES = new Set(["buyer", "seller", "buyer_seller", "viewer"]);
const MARKETPLACE_ACCESS = new Set(["not_invited", "invited", "onboarding", "active", "suspended", "inactive"]);
const PRODUCT_TYPES = new Set(["LINE_OF_CREDIT", "TERM_LOAN", "CRE", "CRE_OWNER_OCCUPIED", "CRE_INVESTOR", "SBA_7A", "SBA_504", "SBA_EXPRESS"]);

function text(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function timestamp(v: unknown): string | null {
  const value = text(v);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
function list(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  return typeof v === "string" ? v.split(",").map((s) => s.trim()).filter(Boolean) : [];
}
async function gate(): Promise<{ userId: string } | NextResponse> {
  try { return await requireBrokerageStaff(); }
  catch { return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }); }
}

export async function bankBuyerGET() {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;
  const bankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const [{ data: profiles, error: profileError }, { data: submissions, error: submissionError }, { data: deals, error: dealError }] = await Promise.all([
    sb.from("crm_lender_profiles").select("*").eq("bank_id", bankId).order("created_at", { ascending: false }),
    sb.from("crm_deal_lender_submissions").select("*").eq("bank_id", bankId).order("updated_at", { ascending: false }),
    sb.from("deals").select("id, display_name, borrower_name, name, loan_amount, brokerage_stage, crm_tracking_only, external_deal_source, external_reference, product_type, state, created_at").eq("bank_id", bankId).order("created_at", { ascending: false }).limit(500),
  ]);
  if (profileError || submissionError || dealError) return NextResponse.json({ ok: false, error: profileError?.message ?? submissionError?.message ?? dealError?.message }, { status: 500 });

  const orgIds = (profiles ?? []).map((p: any) => p.organization_id);
  const [{ data: orgs, error: orgError }, { data: people, error: peopleError }] = await Promise.all([
    orgIds.length ? sb.from("crm_organizations").select("*").eq("bank_id", bankId).in("id", orgIds) : Promise.resolve({ data: [], error: null }),
    orgIds.length ? sb.from("crm_people").select("*").eq("bank_id", bankId).in("organization_id", orgIds).is("merged_into_id", null) : Promise.resolve({ data: [], error: null }),
  ] as any);
  if (orgError || peopleError) return NextResponse.json({ ok: false, error: orgError?.message ?? peopleError?.message }, { status: 500 });

  const orgById = new Map((orgs ?? []).map((o: any) => [o.id, o]));
  const peopleByOrg = new Map<string, any[]>();
  for (const person of people ?? []) peopleByOrg.set(person.organization_id, [...(peopleByOrg.get(person.organization_id) ?? []), person]);
  const dealById = new Map((deals ?? []).map((d: any) => [d.id, d]));
  const profileById = new Map((profiles ?? []).map((p: any) => [p.id, p]));
  const rows = (submissions ?? []).map((s: any) => {
    const p: any = profileById.get(s.lender_profile_id);
    return { ...s, lender: p ? orgById.get(p.organization_id) ?? null : null, lenderProfile: p ?? null, deal: dealById.get(s.deal_id) ?? null };
  });
  const now = Date.now();
  const open = rows.filter((s: any) => !TERMINAL.has(s.status));
  const sent = rows.filter((s: any) => s.status !== "planned");
  const interested = rows.filter((s: any) => ["interested", "term_sheet", "approved", "closed"].includes(s.status));
  const closed = rows.filter((s: any) => s.status === "closed");
  const overdue = open.filter((s: any) => s.next_follow_up_at && new Date(s.next_follow_up_at).getTime() < now);
  const enrichedProfiles = (profiles ?? []).map((p: any) => ({ ...p, organization: orgById.get(p.organization_id) ?? null, contacts: peopleByOrg.get(p.organization_id) ?? [], submissions: rows.filter((s: any) => s.lender_profile_id === p.id) }));

  return NextResponse.json({
    ok: true,
    profiles: enrichedProfiles,
    submissions: rows,
    deals: deals ?? [],
    summary: {
      bankBuyers: enrichedProfiles.length,
      marketplaceMembers: enrichedProfiles.filter((profile: any) => !!profile.marketplace_role).length,
      marketplaceActive: enrichedProfiles.filter((profile: any) => profile.marketplace_access_status === "active").length,
      activeSubmissions: open.length,
      sentCount: sent.length,
      interestedCount: interested.length,
      interestRate: sent.length ? interested.length / sent.length : null,
      closedCount: closed.length,
      closedVolume: closed.reduce((sum: number, s: any) => sum + Number(s.closed_amount ?? 0), 0),
      overdueFollowUps: overdue.length,
    },
  });
}

export async function bankBuyerPOST(req: NextRequest) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;
  const { userId } = gated;
  const bankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const body = await req.json().catch(() => ({}));

  if (body.action === "update_marketplace_profile") {
    const organizationId = text(body.organizationId);
    const marketplaceRole = text(body.marketplaceRole);
    const marketplaceAccessStatus = text(body.marketplaceAccessStatus) ?? "not_invited";
    if (!organizationId) return NextResponse.json({ ok: false, error: "Organization is required" }, { status: 400 });
    if (marketplaceRole && !MARKETPLACE_ROLES.has(marketplaceRole)) return NextResponse.json({ ok: false, error: "Invalid marketplace role" }, { status: 400 });
    if (!MARKETPLACE_ACCESS.has(marketplaceAccessStatus)) return NextResponse.json({ ok: false, error: "Invalid marketplace access status" }, { status: 400 });
    if (!marketplaceRole && marketplaceAccessStatus !== "not_invited") return NextResponse.json({ ok: false, error: "Choose a marketplace role before granting access" }, { status: 400 });

    const { data: organization } = await sb.from("crm_organizations").select("id").eq("id", organizationId).eq("bank_id", bankId).maybeSingle();
    if (!organization) return NextResponse.json({ ok: false, error: "Organization not found in this brokerage" }, { status: 404 });

    const now = new Date().toISOString();
    const marketplacePatch: Record<string, unknown> = {
      marketplace_role: marketplaceRole,
      marketplace_access_status: marketplaceAccessStatus,
      marketplace_onboarding_notes: text(body.marketplaceOnboardingNotes),
      updated_at: now,
    };
    if (marketplaceAccessStatus === "active") marketplacePatch.marketplace_last_active_at = now;
    const { data: existing, error: existingError } = await sb.from("crm_lender_profiles").select("*").eq("bank_id", bankId).eq("organization_id", organizationId).maybeSingle();
    if (existingError) return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 });

    let profile;
    let error;
    if (existing) {
      const result = await sb.from("crm_lender_profiles").update({
        ...marketplacePatch,
        marketplace_first_active_at: marketplaceAccessStatus === "active" && !existing.marketplace_first_active_at ? now : existing.marketplace_first_active_at,
      }).eq("id", existing.id).eq("bank_id", bankId).select("*").single();
      profile = result.data;
      error = result.error;
    } else {
      const result = await sb.from("crm_lender_profiles").insert({
        bank_id: bankId,
        organization_id: organizationId,
        relationship_status: "prospect",
        lender_type: "bank",
        sba_7a_appetite: false,
        sba_504_appetite: false,
        conventional_appetite: false,
        marketplace_first_active_at: marketplaceAccessStatus === "active" ? now : null,
        created_by_clerk_user_id: userId,
        ...marketplacePatch,
      }).select("*").single();
      profile = result.data;
      error = result.error;
    }
    if (error || !profile) return NextResponse.json({ ok: false, error: error?.message ?? "Unable to save marketplace relationship" }, { status: 400 });
    await sb.from("crm_organizations").update({ organization_type: "lender", updated_at: now }).eq("id", organizationId).eq("bank_id", bankId);
    return NextResponse.json({ ok: true, profile });
  }

  if (body.action === "ensure_buyer_relationship") {
    const organizationId = text(body.organizationId);
    if (!organizationId) return NextResponse.json({ ok: false, error: "Organization is required" }, { status: 400 });
    const { data: organization } = await sb.from("crm_organizations").select("id").eq("id", organizationId).eq("bank_id", bankId).maybeSingle();
    if (!organization) return NextResponse.json({ ok: false, error: "Organization not found in this brokerage" }, { status: 404 });

    const { data: existing, error: existingError } = await sb.from("crm_lender_profiles").select("*").eq("bank_id", bankId).eq("organization_id", organizationId).maybeSingle();
    if (existingError) return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 });
    if (existing) return NextResponse.json({ ok: true, profile: existing, created: false });

    const { data: profile, error } = await sb.from("crm_lender_profiles").insert({
      bank_id: bankId,
      organization_id: organizationId,
      relationship_status: "prospect",
      lender_type: "bank",
      sba_7a_appetite: false,
      sba_504_appetite: false,
      conventional_appetite: false,
      created_by_clerk_user_id: userId,
    }).select("*").single();
    if (error || !profile) {
      if (error?.code === "23505") {
        const { data: raced } = await sb.from("crm_lender_profiles").select("*").eq("bank_id", bankId).eq("organization_id", organizationId).maybeSingle();
        if (raced) return NextResponse.json({ ok: true, profile: raced, created: false });
      }
      return NextResponse.json({ ok: false, error: error?.message ?? "Unable to create bank relationship" }, { status: 400 });
    }
    await sb.from("crm_organizations").update({ organization_type: "lender", updated_at: new Date().toISOString() }).eq("id", organizationId).eq("bank_id", bankId);
    return NextResponse.json({ ok: true, profile, created: true });
  }

  if (body.action === "upsert_buyer_profile") {
    const organizationId = text(body.organizationId);
    if (!organizationId) return NextResponse.json({ ok: false, error: "Organization is required" }, { status: 400 });
    const { data: organization } = await sb.from("crm_organizations").select("id").eq("id", organizationId).eq("bank_id", bankId).maybeSingle();
    if (!organization) return NextResponse.json({ ok: false, error: "Organization not found in this brokerage" }, { status: 404 });
    const payload = {
      bank_id: bankId,
      organization_id: organizationId,
      relationship_status: text(body.relationshipStatus) ?? "prospect",
      lender_type: text(body.lenderType) ?? "bank",
      sba_7a_appetite: body.sba7a !== false,
      sba_504_appetite: !!body.sba504,
      conventional_appetite: !!body.conventional,
      min_loan_amount: num(body.minLoanAmount),
      max_loan_amount: num(body.maxLoanAmount),
      min_dscr: num(body.minDscr),
      max_ltv: num(body.maxLtv),
      minimum_fico: num(body.minimumFico),
      industries: list(body.industries),
      excluded_industries: list(body.excludedIndustries),
      geographies: list(body.geographies),
      collateral_preferences: list(body.collateralPreferences),
      deal_preferences: text(body.dealPreferences),
      referral_fee_bps: num(body.referralFeeBps),
      response_sla_days: num(body.responseSlaDays),
      marketplace_role: MARKETPLACE_ROLES.has(text(body.marketplaceRole) ?? "") ? text(body.marketplaceRole) : null,
      marketplace_access_status: MARKETPLACE_ACCESS.has(text(body.marketplaceAccessStatus) ?? "") ? text(body.marketplaceAccessStatus) : "not_invited",
      marketplace_onboarding_notes: text(body.marketplaceOnboardingNotes),
      created_by_clerk_user_id: userId,
      updated_at: new Date().toISOString(),
    };
    const { data: profile, error } = await sb.from("crm_lender_profiles").upsert(payload, { onConflict: "bank_id,organization_id" }).select("*").single();
    if (error || !profile) return NextResponse.json({ ok: false, error: error?.message ?? "Unable to save lending appetite" }, { status: 400 });
    await sb.from("crm_organizations").update({ organization_type: "lender", updated_at: new Date().toISOString() }).eq("id", organizationId).eq("bank_id", bankId);
    return NextResponse.json({ ok: true, profile });
  }

  if (body.action === "create_buyer") {
    const name = text(body.name);
    if (!name) return NextResponse.json({ ok: false, error: "Bank name is required" }, { status: 400 });
    const { data: org, error: orgError } = await sb.from("crm_organizations").insert({
      bank_id: bankId, name, organization_type: "lender", website_url: text(body.websiteUrl), phone: text(body.phone), city: text(body.city), state: text(body.state), notes: text(body.notes), created_by_clerk_user_id: userId,
    }).select("*").single();
    if (orgError || !org) return NextResponse.json({ ok: false, error: orgError?.message ?? "Unable to create bank" }, { status: 500 });

    const { data: profile, error: profileError } = await sb.from("crm_lender_profiles").insert({
      bank_id: bankId, organization_id: org.id, relationship_status: text(body.relationshipStatus) ?? "prospect", lender_type: text(body.lenderType) ?? "bank",
      sba_7a_appetite: body.sba7a !== false, sba_504_appetite: !!body.sba504, conventional_appetite: !!body.conventional,
      min_loan_amount: num(body.minLoanAmount), max_loan_amount: num(body.maxLoanAmount), min_dscr: num(body.minDscr), max_ltv: num(body.maxLtv), minimum_fico: num(body.minimumFico),
      industries: list(body.industries), excluded_industries: list(body.excludedIndustries), geographies: list(body.geographies), collateral_preferences: list(body.collateralPreferences),
      deal_preferences: text(body.dealPreferences), referral_fee_bps: num(body.referralFeeBps), response_sla_days: num(body.responseSlaDays),
      marketplace_role: MARKETPLACE_ROLES.has(text(body.marketplaceRole) ?? "") ? text(body.marketplaceRole) : null,
      marketplace_access_status: MARKETPLACE_ACCESS.has(text(body.marketplaceAccessStatus) ?? "") ? text(body.marketplaceAccessStatus) : "not_invited",
      marketplace_onboarding_notes: text(body.marketplaceOnboardingNotes), created_by_clerk_user_id: userId,
    }).select("*").single();
    if (profileError || !profile) {
      await sb.from("crm_organizations").delete().eq("id", org.id).eq("bank_id", bankId);
      return NextResponse.json({ ok: false, error: profileError?.message ?? "Unable to create lender profile" }, { status: 500 });
    }
    let contact = null;
    if (text(body.contactFirstName) || text(body.contactLastName) || text(body.contactEmail)) {
      const result = await sb.from("crm_people").insert({
        bank_id: bankId, organization_id: org.id, first_name: text(body.contactFirstName), last_name: text(body.contactLastName), email: text(body.contactEmail), phone: text(body.contactPhone), job_title: text(body.contactJobTitle), notes: text(body.contactNotes), created_by_clerk_user_id: userId,
      }).select("*").single();
      if (result.error) return NextResponse.json({ ok: false, error: `Bank saved, but banker contact failed: ${result.error.message}`, profile }, { status: 207 });
      contact = result.data;
    }
    return NextResponse.json({ ok: true, profile, organization: org, contact });
  }

  if (body.action === "create_external_submission") {
    const dealName = text(body.externalDealName);
    const lenderProfileId = text(body.lenderProfileId);
    const amount = num(body.amountSent);
    const productType = text(body.productType) ?? "SBA_7A";
    if (!dealName || !lenderProfileId) return NextResponse.json({ ok: false, error: "Deal name and bank are required" }, { status: 400 });
    if (amount === null || amount <= 0) return NextResponse.json({ ok: false, error: "Enter a valid requested amount" }, { status: 400 });
    if (!PRODUCT_TYPES.has(productType)) return NextResponse.json({ ok: false, error: "Invalid loan program" }, { status: 400 });

    const { data: profile } = await sb.from("crm_lender_profiles").select("id").eq("id", lenderProfileId).eq("bank_id", bankId).maybeSingle();
    if (!profile) return NextResponse.json({ ok: false, error: "Bank relationship not found in this brokerage" }, { status: 404 });

    const sentAt = timestamp(body.sentAt) ?? new Date().toISOString();
    const { data: deal, error: dealError } = await sb.from("deals").insert({
      bank_id: bankId,
      name: dealName,
      display_name: dealName,
      borrower_name: text(body.borrowerName),
      loan_amount: amount,
      state: text(body.dealState),
      product_type: productType,
      deal_type: productType.startsWith("SBA_") ? "SBA" : "CONVENTIONAL",
      status: "active",
      stage: "lender_review",
      brokerage_stage: "lender_review",
      brokerage_stage_entered_at: sentAt,
      origin: "banker_created",
      deal_mode: "quick_look",
      validation_disabled: true,
      crm_tracking_only: true,
      external_deal_source: text(body.externalDealSource),
      external_reference: text(body.externalReference),
      banker_relationship_notes: text(body.notes),
      created_by_user_id: userId,
    }).select("id, loan_amount, display_name, borrower_name, product_type, crm_tracking_only").single();
    if (dealError || !deal) return NextResponse.json({ ok: false, error: dealError?.message ?? "Unable to create external deal record" }, { status: 400 });

    const { data: submission, error: submissionError } = await sb.from("crm_deal_lender_submissions").insert({
      bank_id: bankId,
      deal_id: deal.id,
      lender_profile_id: lenderProfileId,
      banker_person_id: text(body.bankerPersonId),
      status: "sent",
      amount_sent: amount,
      sent_at: sentAt,
      next_follow_up_at: timestamp(body.nextFollowUpAt),
      fit_rationale: text(body.fitRationale),
      notes: text(body.notes),
      created_by_clerk_user_id: userId,
      updated_by_clerk_user_id: userId,
    }).select("*").single();
    if (submissionError || !submission) {
      await sb.from("deals").delete().eq("id", deal.id).eq("bank_id", bankId).eq("crm_tracking_only", true);
      return NextResponse.json({ ok: false, error: submissionError?.message ?? "Unable to record bank distribution" }, { status: 400 });
    }

    await sb.from("crm_lender_submission_events").insert({
      bank_id: bankId,
      submission_id: submission.id,
      event_type: "sent",
      to_status: "sent",
      details: { entry_mode: "external_crm", source: text(body.externalDealSource) },
      actor_clerk_user_id: userId,
    });
    return NextResponse.json({ ok: true, deal, submission });
  }

  if (body.action === "create_submission") {
    const dealId = text(body.dealId);
    const lenderProfileId = text(body.lenderProfileId);
    if (!dealId || !lenderProfileId) return NextResponse.json({ ok: false, error: "Deal and bank are required" }, { status: 400 });
    const status = text(body.status) ?? "sent";
    if (!STATUSES.has(status)) return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
    const [{ data: deal }, { data: profile }] = await Promise.all([
      sb.from("deals").select("id, loan_amount").eq("id", dealId).eq("bank_id", bankId).maybeSingle(),
      sb.from("crm_lender_profiles").select("id").eq("id", lenderProfileId).eq("bank_id", bankId).maybeSingle(),
    ]);
    if (!deal || !profile) return NextResponse.json({ ok: false, error: "Deal or bank not found in this brokerage" }, { status: 404 });
    const now = new Date().toISOString();
    const { data, error } = await sb.from("crm_deal_lender_submissions").insert({
      bank_id: bankId, deal_id: dealId, lender_profile_id: lenderProfileId, banker_person_id: text(body.bankerPersonId), status,
      amount_sent: num(body.amountSent) ?? num(deal.loan_amount), sent_at: status === "planned" ? null : (timestamp(body.sentAt) ?? now), next_follow_up_at: timestamp(body.nextFollowUpAt), fit_rationale: text(body.fitRationale), notes: text(body.notes), created_by_clerk_user_id: userId, updated_by_clerk_user_id: userId,
    }).select("*").single();
    if (error || !data) return NextResponse.json({ ok: false, error: error?.code === "23505" ? "This deal has already been sent to that bank" : error?.message }, { status: 400 });
    await sb.from("crm_lender_submission_events").insert({ bank_id: bankId, submission_id: data.id, event_type: status === "sent" ? "sent" : "created", to_status: status, actor_clerk_user_id: userId });
    return NextResponse.json({ ok: true, submission: data });
  }

  return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
}

export async function bankBuyerPATCH(req: NextRequest) {
  const gated = await gate();
  if (gated instanceof NextResponse) return gated;
  const { userId } = gated;
  const bankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const body = await req.json().catch(() => ({}));
  const id = text(body.id);
  const status = text(body.status);
  if (!id || !status || !STATUSES.has(status)) return NextResponse.json({ ok: false, error: "Valid submission id and status are required" }, { status: 400 });
  if (status === "declined" && !text(body.declineReason)) return NextResponse.json({ ok: false, error: "A decline reason is required" }, { status: 400 });
  if (status === "closed" && (num(body.closedAmount) === null || !text(body.closedAt))) return NextResponse.json({ ok: false, error: "Closed amount and date are required" }, { status: 400 });
  const { data: existing } = await sb.from("crm_deal_lender_submissions").select("*").eq("id", id).eq("bank_id", bankId).maybeSingle();
  if (!existing) return NextResponse.json({ ok: false, error: "Submission not found" }, { status: 404 });
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { status, updated_at: now, updated_by_clerk_user_id: userId };
  if (["reviewing", "interested", "term_sheet", "approved", "declined"].includes(status) && !existing.responded_at) patch.responded_at = now;
  if (["approved", "declined", "lost"].includes(status)) patch.decision_at = now;
  if (status === "declined") patch.decline_reason = text(body.declineReason);
  if (status === "lost") patch.lost_reason = text(body.lostReason);
  if (status === "closed") { patch.closed_amount = num(body.closedAmount); patch.closed_at = text(body.closedAt); }
  if (body.approvedAmount !== undefined) patch.approved_amount = num(body.approvedAmount);
  if (body.nextFollowUpAt !== undefined) patch.next_follow_up_at = text(body.nextFollowUpAt);
  if (body.notes !== undefined) patch.notes = text(body.notes);
  const { data, error } = await sb.from("crm_deal_lender_submissions").update(patch).eq("id", id).eq("bank_id", bankId).select("*").single();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });
  await sb.from("crm_lender_submission_events").insert({ bank_id: bankId, submission_id: id, event_type: "status_changed", from_status: existing.status, to_status: status, details: patch, actor_clerk_user_id: userId });
  return NextResponse.json({ ok: true, submission: data });
}
