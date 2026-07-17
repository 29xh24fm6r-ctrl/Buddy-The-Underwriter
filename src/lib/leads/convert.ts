import "server-only";

/**
 * Convert lead to deal — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR2 §4.3.
 *
 * The one explicit path from a qualified lead to a real deal. Reuses the
 * existing authoritative pieces rather than forking parallel ones:
 *   - checkDuplicateDeal() — the same dedup helper /api/deals/create uses
 *   - deals insert shape — mirrors /api/deals/create's hard rules (no
 *     empty/placeholder names, borrower required before the deal exists)
 *   - deal_audit_log — the existing deal-scoped audit table, event
 *     "deal_created" (existing convention) + "lead_converted" (new, PR2)
 *   - deal_source_attribution (PR1) — the authoritative referral-attribution
 *     record; deals.referral_source_org_id / brokerage_leads.referral_source_org_id
 *     stay as-is for backward compatibility, not written by this command
 *   - linkPartyToDeal() (PR1) — attaches the referring organization as an
 *     external deal party
 *
 * Borrower dedup is net-new here — no borrower-duplicate detection existed
 * anywhere in the codebase before this (confirmed by discovery). It is
 * cautious and non-blocking: candidates are returned for staff review, and
 * conversion only *links* to an existing borrower when the caller explicitly
 * picks one (never auto-merges).
 *
 * Idempotent: converting an already-converted lead returns its existing
 * deal rather than creating a second one.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";
import { checkDuplicateDeal } from "@/lib/deals/checkDuplicateDeal";
import { linkPartyToDeal } from "@/lib/crm/partyRoles";
import { TERMINAL_STAGES } from "./stages";
import type { BrokerageLead } from "./pipeline";

export type BorrowerCandidate = {
  id: string;
  legal_name: string;
  primary_contact_email: string | null;
  matchReason: string;
};

async function findDuplicateBorrowerCandidates(
  bankId: string,
  args: { businessName: string | null; email: string | null },
  sb: SB,
): Promise<BorrowerCandidate[]> {
  const candidates: BorrowerCandidate[] = [];
  const seen = new Set<string>();

  if (args.businessName?.trim()) {
    const { data } = await sb
      .from("borrowers")
      .select("id, legal_name, primary_contact_email")
      .eq("bank_id", bankId)
      .ilike("legal_name", args.businessName.trim());
    for (const row of (data ?? []) as any[]) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        candidates.push({ ...row, matchReason: "exact business name match" });
      }
    }
  }

  if (args.email?.trim()) {
    const { data } = await sb
      .from("borrowers")
      .select("id, legal_name, primary_contact_email")
      .eq("bank_id", bankId)
      .ilike("primary_contact_email", args.email.trim());
    for (const row of (data ?? []) as any[]) {
      if (!seen.has(row.id)) {
        seen.add(row.id);
        candidates.push({ ...row, matchReason: "exact contact email match" });
      }
    }
  }

  return candidates;
}

export type ConvertLeadToDealInput = {
  bankId: string;
  leadId: string;
  actorClerkUserId: string;
  /** Staff picked an existing borrower from the duplicate-candidate review instead of creating a new one. */
  borrowerId?: string | null;
  dealName?: string | null;
};

export type ConvertLeadToDealResult = {
  dealId: string;
  borrowerId: string;
  reused: boolean;
  duplicateBorrowerCandidates: BorrowerCandidate[];
};

export type ConvertPreview = {
  proposedBorrowerName: string;
  proposedDealName: string;
  duplicateBorrowerCandidates: BorrowerCandidate[];
  alreadyConverted: boolean;
  existingDealId: string | null;
};

/**
 * Non-mutating preview for the "conversion review before final submission"
 * requirement — surfaces duplicate-borrower candidates and the proposed
 * borrower/deal names without writing anything.
 */
export async function previewConvertLeadToDeal(bankId: string, leadId: string, sb: SB = supabaseAdmin()): Promise<ConvertPreview> {
  const { data: leadRow, error: leadErr } = await sb
    .from("brokerage_leads")
    .select("*")
    .eq("id", leadId)
    .eq("bank_id", bankId)
    .single();
  if (leadErr || !leadRow) throw new Error(`previewConvertLeadToDeal: lead not found (${leadErr?.message ?? "no such lead"}).`);
  const lead = leadRow as BrokerageLead;

  if (lead.status === "converted") {
    return {
      proposedBorrowerName: "",
      proposedDealName: "",
      duplicateBorrowerCandidates: [],
      alreadyConverted: true,
      existingDealId: (lead.converted_deal_id as string) ?? null,
    };
  }

  const businessName = (lead.business_name as string | null) ?? null;
  const contactName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || null;
  const email = (lead.email as string | null) ?? null;
  const borrowerDisplayName = businessName || contactName || "New Borrower";
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return {
    proposedBorrowerName: borrowerDisplayName,
    proposedDealName: `${borrowerDisplayName} — ${today}`,
    duplicateBorrowerCandidates: await findDuplicateBorrowerCandidates(bankId, { businessName, email }, sb),
    alreadyConverted: false,
    existingDealId: null,
  };
}

export async function convertLeadToDeal(input: ConvertLeadToDealInput, sb: SB = supabaseAdmin()): Promise<ConvertLeadToDealResult> {
  const { data: leadRow, error: leadErr } = await sb
    .from("brokerage_leads")
    .select("*")
    .eq("id", input.leadId)
    .eq("bank_id", input.bankId)
    .single();
  if (leadErr || !leadRow) throw new Error(`convertLeadToDeal: lead not found (${leadErr?.message ?? "no such lead"}).`);
  const lead = leadRow as BrokerageLead;

  // Idempotent: already converted, just hand back the existing deal.
  if (lead.status === "converted" && lead.converted_deal_id) {
    return { dealId: lead.converted_deal_id, borrowerId: input.borrowerId ?? "", reused: true, duplicateBorrowerCandidates: [] };
  }

  if (TERMINAL_STAGES.has(lead.status) && lead.status !== "converted") {
    throw new Error(`Cannot convert a lead in terminal stage '${lead.status}'.`);
  }

  const businessName = (lead.business_name as string | null) ?? null;
  const contactName = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || null;
  const email = (lead.email as string | null) ?? null;

  const duplicateBorrowerCandidates = input.borrowerId
    ? []
    : await findDuplicateBorrowerCandidates(input.bankId, { businessName, email }, sb);

  // Compute the proposed borrower/deal name and check for a duplicate deal
  // *before* writing anything — reusing an existing deal must not leave a
  // stray, unused borrower row behind.
  const proposedBorrowerName = input.borrowerId ? null : businessName || contactName || "New Borrower";
  const today = new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const dealName = input.dealName?.trim() || `${proposedBorrowerName ?? businessName ?? contactName ?? "New Borrower"} — ${today}`;

  const dupCheck = await checkDuplicateDeal({ bankId: input.bankId, name: dealName, createdByUserId: input.actorClerkUserId }, sb);
  if (dupCheck.ok && dupCheck.isDuplicate) {
    // Reuse the existing deal rather than forking a second one for the same
    // borrower — still mark this lead converted so it leaves the pipeline.
    const { data: existingDeal } = await sb.from("deals").select("borrower_id").eq("id", dupCheck.existingDealId).maybeSingle();
    await finalizeLeadConversion(input.bankId, input.leadId, dupCheck.existingDealId, input.actorClerkUserId, sb);
    return { dealId: dupCheck.existingDealId, borrowerId: existingDeal?.borrower_id ?? "", reused: true, duplicateBorrowerCandidates };
  }

  // ── Borrower: link to an explicitly-chosen existing one, or create ──────
  let borrowerId: string;
  let borrowerDisplayName: string;

  if (input.borrowerId) {
    const { data: existingBorrower, error: bErr } = await sb
      .from("borrowers")
      .select("id, legal_name")
      .eq("id", input.borrowerId)
      .eq("bank_id", input.bankId)
      .maybeSingle();
    if (bErr || !existingBorrower) throw new Error("convertLeadToDeal: chosen borrowerId not found for this bank.");
    borrowerId = existingBorrower.id;
    borrowerDisplayName = existingBorrower.legal_name ?? businessName ?? contactName ?? "New Borrower";
  } else {
    borrowerDisplayName = proposedBorrowerName as string;
    const { data: newBorrower, error: bErr } = await sb
      .from("borrowers")
      .insert({
        bank_id: input.bankId,
        legal_name: borrowerDisplayName,
        primary_contact_name: contactName,
        primary_contact_email: email,
      })
      .select("id, legal_name")
      .single();
    if (bErr || !newBorrower) throw new Error(`convertLeadToDeal: failed to create borrower (${bErr?.message}).`);
    borrowerId = newBorrower.id;
  }

  const dealId = crypto.randomUUID();
  const now = new Date().toISOString();
  const { error: dealErr } = await sb.from("deals").insert({
    id: dealId,
    bank_id: input.bankId,
    borrower_id: borrowerId,
    name: dealName,
    borrower_name: borrowerDisplayName,
    stage: "intake",
    entity_type: "Unknown",
    risk_score: 0,
    created_at: now,
    updated_at: now,
    created_by_user_id: input.actorClerkUserId,
  });
  if (dealErr) throw new Error(`convertLeadToDeal: failed to create deal (${dealErr.message}).`);

  await sb.from("deal_audit_log").insert({
    deal_id: dealId,
    bank_id: input.bankId,
    actor_id: input.actorClerkUserId,
    event: "deal_created",
    payload: { borrower_id: borrowerId, deal_name: dealName, source: "lead_conversion", lead_id: input.leadId },
  }).then(null, () => {});
  await sb.from("deal_audit_log").insert({
    deal_id: dealId,
    bank_id: input.bankId,
    actor_id: input.actorClerkUserId,
    event: "lead_converted",
    payload: { lead_id: input.leadId },
  }).then(null, () => {});

  if (lead.referral_source_org_id) {
    await sb.from("deal_source_attribution").insert({
      bank_id: input.bankId,
      deal_id: dealId,
      first_touch_source: lead.source ?? null,
      last_touch_source: lead.source ?? null,
      referring_organization_id: lead.referral_source_org_id,
      internal_owner_clerk_user_id: lead.owner_clerk_user_id ?? null,
    }).then(null, () => {});

    await linkPartyToDeal(
      { bankId: input.bankId, dealId, role: "referral_source", organizationId: lead.referral_source_org_id as string, createdByClerkUserId: input.actorClerkUserId },
      sb,
    ).catch(() => {});
  }

  await finalizeLeadConversion(input.bankId, input.leadId, dealId, input.actorClerkUserId, sb);

  return { dealId, borrowerId, reused: false, duplicateBorrowerCandidates };
}

async function finalizeLeadConversion(bankId: string, leadId: string, dealId: string, actorClerkUserId: string, sb: SB): Promise<void> {
  const now = new Date().toISOString();
  await sb
    .from("brokerage_leads")
    .update({
      status: "converted",
      stage_entered_at: now,
      converted_deal_id: dealId,
      converted_at: now,
      converted_by_clerk_user_id: actorClerkUserId,
    })
    .eq("id", leadId)
    .eq("bank_id", bankId);

  await sb.from("crm_activities").insert({
    bank_id: bankId,
    kind: "stage_change",
    title: "Lead converted to deal",
    properties: { toStage: "converted", dealId },
    actor_clerk_user_id: actorClerkUserId,
    target_lead_id: leadId,
  });
}
