import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { requireBrokerageStaff } from "@/lib/auth/requireBrokerageStaff";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeStateCode } from "@/lib/crm/geography";
import { createOrganization } from "@/lib/crm/organizations";

export const runtime = "nodejs";

/**
 * POST /api/admin/brokerage/deals — the brokerage's single deal front door.
 *
 * There used to be two doors that produced different-shaped rows in the same
 * table: this one (a real deal with a borrower, reached from the pipeline)
 * and the bank-buyers workspace's "off-platform deal" (a crm_tracking_only
 * shadow with no borrower and no document workspace). Same table, two
 * lifecycles, no signposting between them — a broker loading their own deal
 * had to guess which one they wanted.
 *
 * One door now, with intakeMode naming what kind of record this is rather
 * than leaving it to be inferred from a boolean plus a free-text source
 * string. The tracking_only mode still produces the lightweight record the
 * bank-buyers flow needs; the other three produce a working deal.
 *
 * The same submit also creates the CRM side — the borrower's organization,
 * the contact, and the source attribution — because a deal whose relationship
 * has to be re-entered somewhere else is how the CRM ended up disconnected
 * from the pipeline in the first place. Document upload happens next, from
 * the client, through the canonical /api/deals/[dealId]/files/sign ingest
 * path (see directDealDocumentUpload); this route deliberately does not
 * become a second document writer.
 */

const INTAKE_MODES = new Set(["self_sourced", "referred", "inbound_portal", "tracking_only"]);
const PRODUCT_TYPES = new Set([
  "SBA_7A",
  "SBA_504",
  "SBA_EXPRESS",
  "TERM_LOAN",
  "LINE_OF_CREDIT",
  "CRE_OWNER_OCCUPIED",
  "CRE_INVESTOR",
]);

function text(value: unknown, max = 200): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function naics(value: unknown): string | null {
  const raw = text(value, 12);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 2 && digits.length <= 6 ? digits : null;
}

export async function POST(req: NextRequest) {
  let userId: string;
  try { ({ userId } = await requireBrokerageStaff()); }
  catch { return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 }); }

  const body = await req.json().catch(() => ({}));
  const businessName = text(body.businessName, 160);
  const borrowerName = text(body.borrowerName, 160);
  const amount = Number(body.loanAmount);

  if (!businessName || !borrowerName) {
    return NextResponse.json({ ok: false, error: "Business and borrower names are required." }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) {
    return NextResponse.json({ ok: false, error: "Enter a valid requested loan amount." }, { status: 400 });
  }

  const intakeMode = INTAKE_MODES.has(String(body.intakeMode)) ? String(body.intakeMode) : "self_sourced";
  const productType = PRODUCT_TYPES.has(String(body.productType)) ? String(body.productType) : "SBA_7A";
  const stateCode = normalizeStateCode(body.stateCode ?? body.state);
  const naicsCode = naics(body.naicsCode);
  const trackingOnly = intakeMode === "tracking_only";

  if (body.stateCode && !stateCode) {
    return NextResponse.json({ ok: false, error: "Choose a US state, or leave it blank." }, { status: 400 });
  }

  const bankId = await getBrokerageBankId();
  const sb = supabaseAdmin();
  const now = new Date().toISOString();

  // A referral source, when named, must belong to this brokerage — the id
  // arrives from a client picker and is a foreign key on the deal.
  const referralOrgId = text(body.referralOrganizationId, 64);
  if (referralOrgId) {
    const { data: referrer } = await sb
      .from("crm_organizations").select("id").eq("id", referralOrgId).eq("bank_id", bankId).maybeSingle();
    if (!referrer) {
      return NextResponse.json({ ok: false, error: "Referral source not found in this brokerage." }, { status: 400 });
    }
  }

  // A tracking-only record exists to be distributed, not underwritten, so it
  // gets no borrower row — matching what the bank-buyers flow always did.
  let borrowerId: string | null = null;
  if (!trackingOnly) {
    const { data: borrower, error: borrowerError } = await sb.from("borrowers").insert({
      bank_id: bankId,
      legal_name: borrowerName,
      entity_type: text(body.entityType, 60),
      naics_code: naicsCode,
      state: stateCode,
      primary_contact_name: text(body.contactName, 160),
      primary_contact_email: text(body.contactEmail, 200),
      phone: text(body.contactPhone, 40),
    }).select("id").single();
    if (borrowerError || !borrower) {
      return NextResponse.json({ ok: false, error: borrowerError?.message ?? "Could not create borrower." }, { status: 500 });
    }
    borrowerId = borrower.id;
  }

  const dealId = crypto.randomUUID();
  const { error: dealError } = await sb.from("deals").insert({
    id: dealId,
    bank_id: bankId,
    borrower_id: borrowerId,
    name: businessName,
    display_name: businessName,
    borrower_name: borrowerName,
    borrower_email: text(body.contactEmail, 200),
    loan_amount: amount,
    state: stateCode,
    product_type: productType,
    deal_type: productType.startsWith("SBA_") ? "SBA" : "CONVENTIONAL",
    stage: trackingOnly ? "lender_review" : "intake",
    brokerage_stage: trackingOnly ? "lender_review" : "document_collection",
    brokerage_stage_entered_at: now,
    brokerage_stage_owner_clerk_user_id: text(body.ownerClerkUserId, 64) ?? userId,
    origin: "banker_created",
    intake_mode: intakeMode,
    crm_tracking_only: trackingOnly,
    external_deal_source: text(body.externalDealSource, 120)
      ?? (intakeMode === "self_sourced" ? "brokerage_self_sourced_package" : null),
    external_reference: text(body.externalReference, 120),
    referral_source_org_id: referralOrgId,
    entity_type: text(body.entityType, 60) ?? "Unknown",
    banker_relationship_notes: text(body.notes, 2000),
    risk_score: 0,
    created_by_user_id: userId,
    created_at: now,
    updated_at: now,
    ...(trackingOnly ? { deal_mode: "quick_look", validation_disabled: true, status: "active" } : {}),
  });
  if (dealError) {
    if (borrowerId) await sb.from("borrowers").delete().eq("id", borrowerId).eq("bank_id", bankId);
    return NextResponse.json({ ok: false, error: dealError.message }, { status: 500 });
  }

  // ── The CRM side of the same submit ───────────────────────────────────
  // Everything below is best-effort: the deal exists and is usable, and a
  // failure to attach a contact record must not cost the broker the deal
  // they just typed. Failures are reported back so the UI can say so.
  const warnings: string[] = [];

  let organizationId: string | null = null;
  if (body.createCrmOrganization !== false) {
    try {
      const organization = await createOrganization({
        bankId,
        name: businessName,
        organizationType: "borrower_business",
        city: text(body.city, 80),
        state: stateCode,
        phone: text(body.contactPhone, 40),
        howWeMet: text(body.externalDealSource, 200),
        createdByClerkUserId: userId,
      }, sb);
      organizationId = organization.id;
    } catch (e) {
      warnings.push(`Deal saved, but the CRM organization was not created: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  let personId: string | null = null;
  const contactName = text(body.contactName, 160);
  const contactEmail = text(body.contactEmail, 200);
  if (organizationId && (contactName || contactEmail)) {
    const [firstName, ...rest] = (contactName ?? "").split(/\s+/);
    const { data: person, error: personError } = await sb.from("crm_people").insert({
      bank_id: bankId,
      organization_id: organizationId,
      first_name: firstName || null,
      last_name: rest.join(" ") || null,
      email: contactEmail,
      phone: text(body.contactPhone, 40),
      job_title: text(body.contactJobTitle, 120),
      created_by_clerk_user_id: userId,
    }).select("id").single();
    if (personError) warnings.push(`Deal saved, but the contact was not created: ${personError.message}`);
    else personId = person.id;
  }

  // deal_party_roles models the EXTERNAL parties on a deal — its role check
  // has no 'borrower' entry, and the borrower is already carried by
  // deals.borrower_id plus the organization created above. What does belong
  // here is the referral source, so the org page and the deal partners view
  // both show this deal without a second round of data entry.
  if (referralOrgId) {
    const { error: partyError } = await sb.from("deal_party_roles").insert({
      bank_id: bankId,
      deal_id: dealId,
      role: "referral_source",
      organization_id: referralOrgId,
      created_by_clerk_user_id: userId,
    });
    if (partyError) warnings.push(`Deal saved, but the referral party role was not attached: ${partyError.message}`);
  }

  // One attribution row per deal (deal_source_attribution_one_per_deal), so
  // upsert rather than insert — a retry must not fail on the unique key.
  const { error: attributionError } = await sb.from("deal_source_attribution").upsert({
    bank_id: bankId,
    deal_id: dealId,
    first_touch_source: intakeMode,
    last_touch_source: intakeMode,
    referring_organization_id: referralOrgId,
    internal_owner_clerk_user_id: text(body.ownerClerkUserId, 64) ?? userId,
    notes: text(body.externalDealSource, 200),
  }, { onConflict: "deal_id" });
  if (attributionError) warnings.push(`Deal saved, but source attribution was not recorded: ${attributionError.message}`);

  await Promise.all([
    sb.from("deal_audit_log").insert({
      deal_id: dealId, bank_id: bankId, actor_id: userId, event: "admin_self_sourced_deal_created",
      payload: { borrower_id: borrowerId, business_name: businessName, loan_amount: amount, intake_mode: intakeMode },
    }),
    sb.from("deal_brokerage_stage_transitions").insert({
      bank_id: bankId, deal_id: dealId, from_stage: null,
      to_stage: trackingOnly ? "lender_review" : "document_collection",
      reason: "Admin loaded a deal through the brokerage front door", actor_clerk_user_id: userId,
    }),
  ]);

  return NextResponse.json(
    { ok: true, dealId, organizationId, personId, warnings, next: `/admin/brokerage/pipeline/${dealId}` },
    { status: 201 },
  );
}
