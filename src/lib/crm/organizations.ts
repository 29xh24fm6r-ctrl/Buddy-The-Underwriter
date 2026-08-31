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
import { normalizeStateCode } from "./geography";
import { ensureLenderProfile } from "./lenderProfile";
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

/**
 * How much of the brokerage's attention a relationship earns. Enforced by
 * crm_organizations_relationship_tier_check (migration 20260831140000).
 */
export const RELATIONSHIP_TIERS = ["strategic", "core", "developing", "dormant"] as const;
export type RelationshipTier = (typeof RELATIONSHIP_TIERS)[number];

export function isRelationshipTier(value: unknown): value is RelationshipTier {
  return typeof value === "string" && (RELATIONSHIP_TIERS as readonly string[]).includes(value);
}

/** Trims, drops blanks, dedupes, and caps a tag list. */
export function normalizeTags(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === "string"
      ? value.split(",")
      : [];
  return Array.from(new Set(raw.map((t) => t.trim()).filter(Boolean))).slice(0, 24);
}

/**
 * Brokerage-defined key/value pairs. Values are coerced to strings so the
 * column stays a flat, filterable map rather than an arbitrary JSON tree.
 */
export function normalizeCustomFields(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = key.trim().slice(0, 60);
    if (!name) continue;
    if (raw === null || raw === undefined) continue;
    const text = String(raw).trim().slice(0, 500);
    if (text) out[name] = text;
    if (Object.keys(out).length >= 40) break;
  }
  return out;
}

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
  state_code: string | null;
  tags: string[];
  relationship_tier: RelationshipTier | null;
  owner_clerk_user_id: string | null;
  how_we_met: string | null;
  custom_fields: Record<string, string>;
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
  tags?: string[] | null;
  relationshipTier?: RelationshipTier | null;
  ownerClerkUserId?: string | null;
  howWeMet?: string | null;
  customFields?: Record<string, unknown> | null;
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
      state_code: normalizeStateCode(input.state),
      notes: input.notes ?? null,
      tags: normalizeTags(input.tags),
      relationship_tier: isRelationshipTier(input.relationshipTier) ? input.relationshipTier : null,
      owner_clerk_user_id: input.ownerClerkUserId ?? null,
      how_we_met: input.howWeMet ?? null,
      custom_fields: normalizeCustomFields(input.customFields),
      created_by_clerk_user_id: input.createdByClerkUserId ?? null,
    })
    .select("*")
    .single();

  if (error) throw new Error(`createOrganization failed: ${error.message}`);
  if ((input.organizationType ?? "referral_source") === "lender") {
    await ensureLenderProfile(sb, input.bankId, data.id, input.createdByClerkUserId ?? null);
  }
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
  if (patch.state !== undefined) {
    row.state = patch.state;
    // state stays the free-text display value; state_code is the searchable
    // one, so they are always written together and can never drift.
    row.state_code = normalizeStateCode(patch.state);
  }
  if (patch.postalCode !== undefined) row.postal_code = patch.postalCode;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.tags !== undefined) row.tags = normalizeTags(patch.tags);
  if (patch.relationshipTier !== undefined) {
    row.relationship_tier = isRelationshipTier(patch.relationshipTier) ? patch.relationshipTier : null;
  }
  if (patch.ownerClerkUserId !== undefined) row.owner_clerk_user_id = patch.ownerClerkUserId || null;
  if (patch.howWeMet !== undefined) row.how_we_met = patch.howWeMet;
  if (patch.customFields !== undefined) row.custom_fields = normalizeCustomFields(patch.customFields);

  const { data, error } = await sb
    .from("crm_organizations")
    .update(row)
    .eq("id", organizationId)
    .eq("bank_id", bankId)
    .select("*")
    .single();

  if (error) throw new Error(`updateOrganization failed: ${error.message}`);
  // Retyping an organization as a lender is the other way the two halves of a
  // bank record could fall out of step. See ensureLenderProfile.
  if (patch.organizationType === "lender") {
    await ensureLenderProfile(sb, bankId, organizationId, null);
  }
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
