import "server-only";

/**
 * Organization domain service — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR1.
 *
 * Single write path for crm_organizations so every caller (API routes,
 * lead-entry inline org creation, future automation) creates/updates
 * organizations the same way instead of each route hand-rolling its own
 * insert/update against the table.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "./types";

export const ORGANIZATION_TYPES = [
  "referral_source",
  "professional_partner",
  "borrower_business",
  "cpa_firm",
  "law_firm",
  "lender",
  "insurance_provider",
  "appraisal_firm",
  "environmental_firm",
  "title_company",
  "franchise_organization",
  "seller",
  "landlord",
  "investor",
  "vendor",
  "other",
] as const;

export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export type CrmOrganization = {
  id: string;
  bank_id: string;
  name: string;
  organization_type: OrganizationType;
  website_url: string | null;
  phone: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  notes: string | null;
  created_by_clerk_user_id: string | null;
  created_at: string;
  updated_at: string;
  merged_into_id: string | null;
  merged_at: string | null;
};

export type CreateOrganizationInput = {
  bankId: string;
  name: string;
  organizationType?: OrganizationType;
  websiteUrl?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  notes?: string | null;
  createdByClerkUserId?: string | null;
};

export type UpdateOrganizationInput = Partial<
  Omit<CreateOrganizationInput, "bankId" | "createdByClerkUserId">
>;

export async function createOrganization(input: CreateOrganizationInput, sb: SB = supabaseAdmin()): Promise<CrmOrganization> {
  const name = input.name.trim();
  if (!name) throw new Error("Organization name is required.");

  const { data, error } = await sb
    .from("crm_organizations")
    .insert({
      bank_id: input.bankId,
      name,
      organization_type: input.organizationType ?? "referral_source",
      website_url: input.websiteUrl ?? null,
      phone: input.phone ?? null,
      address_line1: input.addressLine1 ?? null,
      city: input.city ?? null,
      state: input.state ?? null,
      postal_code: input.postalCode ?? null,
      notes: input.notes ?? null,
      created_by_clerk_user_id: input.createdByClerkUserId ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(`createOrganization failed: ${error.message}`);
  return data as CrmOrganization;
}

export async function updateOrganization(
  bankId: string,
  organizationId: string,
  patch: UpdateOrganizationInput,
  sb: SB = supabaseAdmin(),
): Promise<CrmOrganization> {
  const row: Record<string, unknown> = {};
  if (patch.name !== undefined) row.name = patch.name.trim();
  if (patch.organizationType !== undefined) row.organization_type = patch.organizationType;
  if (patch.websiteUrl !== undefined) row.website_url = patch.websiteUrl;
  if (patch.phone !== undefined) row.phone = patch.phone;
  if (patch.addressLine1 !== undefined) row.address_line1 = patch.addressLine1;
  if (patch.city !== undefined) row.city = patch.city;
  if (patch.state !== undefined) row.state = patch.state;
  if (patch.postalCode !== undefined) row.postal_code = patch.postalCode;
  if (patch.notes !== undefined) row.notes = patch.notes;

  const { data, error } = await sb
    .from("crm_organizations")
    .update(row)
    .eq("id", organizationId)
    .eq("bank_id", bankId)
    .select("*")
    .single();

  if (error) throw new Error(`updateOrganization failed: ${error.message}`);
  return data as CrmOrganization;
}

export async function getOrganization(bankId: string, organizationId: string, sb: SB = supabaseAdmin()): Promise<CrmOrganization | null> {
  const { data, error } = await sb
    .from("crm_organizations")
    .select("*")
    .eq("id", organizationId)
    .eq("bank_id", bankId)
    .maybeSingle();

  if (error) throw new Error(`getOrganization failed: ${error.message}`);
  return (data as CrmOrganization) ?? null;
}
