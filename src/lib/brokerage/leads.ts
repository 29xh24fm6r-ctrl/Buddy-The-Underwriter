import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "@/lib/crm/types";

/**
 * brokerage_leads existed in the schema with nothing writing to it —
 * conversionFunnel.ts and liveFunnelCheck.ts have been reporting on an
 * always-empty table. This module is the single write path so every
 * capture point (concierge claim, referral-partner submission, future
 * marketing forms) lands in the same place with the same dedup rules.
 *
 * Dedup: one lead per (bank_id, email) when email is known, else one per
 * (bank_id, phone). Re-submitting an existing lead updates it in place
 * rather than creating a duplicate — a referral partner calling in a
 * borrower who already started the concierge chat should merge, not fork.
 */

export type LeadSource =
  | "concierge_chat"
  | "referral_partner"
  | "franchise_search"
  | "manual_staff_entry"
  | "other";

export type UpsertLeadArgs = {
  bankId: string;
  source: LeadSource;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  loanAmountRequested?: number | null;
  loanPurpose?: string | null;
  referralSourceOrgId?: string | null;
  dealId?: string | null;
  metadata?: Record<string, unknown>;
};

export type UpsertLeadResult = {
  id: string;
  isNew: boolean;
};

export async function upsertBrokerageLead(
  args: UpsertLeadArgs,
  sb: SB = supabaseAdmin(),
): Promise<UpsertLeadResult | null> {
  const email = normalize(args.email);
  const phone = normalize(args.phone);

  // Nothing to identify this person by — don't write a row we can never
  // dedup or follow up on later.
  if (!email && !phone) return null;

  let existingId: string | null = null;
  if (email) {
    const { data } = await sb
      .from("brokerage_leads")
      .select("id")
      .eq("bank_id", args.bankId)
      .eq("email", email)
      .maybeSingle();
    existingId = data?.id ?? null;
  }
  if (!existingId && phone) {
    const { data } = await sb
      .from("brokerage_leads")
      .select("id")
      .eq("bank_id", args.bankId)
      .eq("phone", phone)
      .maybeSingle();
    existingId = data?.id ?? null;
  }

  const patch: Record<string, unknown> = {
    bank_id: args.bankId,
    source: args.source,
  };
  if (email) patch.email = email;
  if (phone) patch.phone = phone;
  if (args.firstName) patch.first_name = args.firstName;
  if (args.lastName) patch.last_name = args.lastName;
  if (args.businessName) patch.business_name = args.businessName;
  if (args.loanAmountRequested != null) patch.loan_amount_requested = args.loanAmountRequested;
  if (args.loanPurpose) patch.loan_purpose = args.loanPurpose;
  if (args.referralSourceOrgId) patch.referral_source_org_id = args.referralSourceOrgId;
  if (args.metadata) patch.metadata = args.metadata;
  if (args.dealId) {
    patch.converted_deal_id = args.dealId;
    patch.converted_at = new Date().toISOString();
    patch.status = "converted";
  }

  if (existingId) {
    const { error } = await sb
      .from("brokerage_leads")
      .update(patch)
      .eq("id", existingId);
    if (error) throw new Error(`upsertBrokerageLead update failed: ${error.message}`);
    return { id: existingId, isNew: false };
  }

  const { data, error } = await sb
    .from("brokerage_leads")
    .insert({ status: args.dealId ? "converted" : "new", ...patch })
    .select("id")
    .single();
  if (error) throw new Error(`upsertBrokerageLead insert failed: ${error.message}`);
  return { id: data.id as string, isNew: true };
}

function normalize(v: string | null | undefined): string | null {
  if (!v) return null;
  const t = v.trim().toLowerCase();
  return t.length > 0 ? t : null;
}
