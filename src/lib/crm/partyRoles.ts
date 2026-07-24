import "server-only";

/**
 * Deal party-role domain service — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR1.
 *
 * deal_party_roles is scoped to EXTERNAL parties only (referral sources,
 * CPAs, attorneys, title companies, etc.) — roles with no existing
 * authoritative table. Internal-staff roles (broker/underwriter/closer/
 * ...) live in deal_participants; borrower/owner/guarantor identity lives
 * in ownership_entities. This service deliberately does not touch either
 * of those — see the migration header comment for the full rationale.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "./types";

export const DEAL_PARTY_ROLES = [
  "referral_source",
  "referral_contact",
  "cpa",
  "attorney",
  "insurance_agent",
  "appraiser",
  "environmental_firm",
  "title_company",
  "franchise_representative",
  "seller",
  "landlord",
  "investor",
  "other",
] as const;

export type DealPartyRole = (typeof DEAL_PARTY_ROLES)[number];

export type DealPartyRoleRecord = {
  id: string;
  bank_id: string;
  deal_id: string;
  role: DealPartyRole;
  person_id: string | null;
  organization_id: string | null;
  notes: string | null;
  created_by_clerk_user_id: string | null;
  created_at: string;
  updated_at: string;
};

export type LinkPartyToDealInput = {
  bankId: string;
  dealId: string;
  role: DealPartyRole;
  personId?: string | null;
  organizationId?: string | null;
  notes?: string | null;
  createdByClerkUserId?: string | null;
};

export async function linkPartyToDeal(input: LinkPartyToDealInput, sb: SB = supabaseAdmin()): Promise<DealPartyRoleRecord> {
  const hasPerson = !!input.personId;
  const hasOrg = !!input.organizationId;
  if (hasPerson === hasOrg) {
    throw new Error("linkPartyToDeal requires exactly one of personId or organizationId.");
  }

  const { data, error } = await sb
    .from("deal_party_roles")
    .insert({
      bank_id: input.bankId,
      deal_id: input.dealId,
      role: input.role,
      person_id: input.personId ?? null,
      organization_id: input.organizationId ?? null,
      notes: input.notes ?? null,
      created_by_clerk_user_id: input.createdByClerkUserId ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(`linkPartyToDeal failed: ${error.message}`);
  return data as DealPartyRoleRecord;
}

export async function removePartyFromDeal(bankId: string, partyRoleId: string, sb: SB = supabaseAdmin()): Promise<void> {
  const { error } = await sb
    .from("deal_party_roles")
    .delete()
    .eq("id", partyRoleId)
    .eq("bank_id", bankId);
  if (error) throw new Error(`removePartyFromDeal failed: ${error.message}`);
}

export type ResolvedDealPartyRole = DealPartyRoleRecord & {
  personName: string | null;
  organizationName: string | null;
};

export async function listPartyRolesForDeal(bankId: string, dealId: string, sb: SB = supabaseAdmin()): Promise<ResolvedDealPartyRole[]> {
  const { data, error } = await sb
    .from("deal_party_roles")
    .select("*, person:crm_people(first_name,last_name), organization:crm_organizations(name)")
    .eq("bank_id", bankId)
    .eq("deal_id", dealId)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`listPartyRolesForDeal failed: ${error.message}`);

  return ((data ?? []) as any[]).map((row) => ({
    ...row,
    personName: row.person ? [row.person.first_name, row.person.last_name].filter(Boolean).join(" ") || null : null,
    organizationName: row.organization?.name ?? null,
    person: undefined,
    organization: undefined,
  })) as ResolvedDealPartyRole[];
}
