import "server-only";

/**
 * Person domain service — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR1.
 *
 * Single write path for crm_people and crm_person_organization_roles.
 * A person may belong to multiple organizations with multiple roles —
 * crm_people.organization_id (kept for backward compat) can only ever
 * point to one, so that column is never written by this service for new
 * relationships; linkPersonToOrganization is the real path.
 *
 * Every function takes the db client as its last (optional, defaulted)
 * parameter rather than only calling supabaseAdmin() internally, matching
 * the convention in src/lib/brokerage/*.ts (e.g. revenueOps.ts) so these
 * are unit-testable against an in-memory fake without a real database.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { SB } from "./types";

export type ContactStatus = "active" | "inactive" | "do_not_contact";
export type PersonOrgRole = "contact" | "decision_maker" | "billing_contact" | "referral_contact" | "primary_contact" | "other";

export type CrmPerson = {
  id: string;
  bank_id: string;
  organization_id: string | null;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  email: string | null;
  phone: string | null;
  mobile_phone: string | null;
  job_title: string | null;
  linkedin_url: string | null;
  communication_preference: string | null;
  contact_status: ContactStatus;
  relationship_owner_clerk_user_id: string | null;
  do_not_contact: boolean;
  last_contacted_at: string | null;
  last_response_at: string | null;
  notes: string | null;
  created_by_clerk_user_id: string | null;
  created_at: string;
  updated_at: string;
  merged_into_id: string | null;
  merged_at: string | null;
};

export type CrmPersonOrganizationRole = {
  id: string;
  bank_id: string;
  person_id: string;
  organization_id: string;
  role: PersonOrgRole;
  job_title: string | null;
  start_date: string | null;
  end_date: string | null;
  is_primary_contact: boolean;
  is_decision_maker: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type CreatePersonInput = {
  bankId: string;
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  email?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  jobTitle?: string | null;
  linkedinUrl?: string | null;
  communicationPreference?: string | null;
  relationshipOwnerClerkUserId?: string | null;
  notes?: string | null;
  createdByClerkUserId?: string | null;
  /** Convenience: link to one organization at creation time (primary contact by default). */
  organizationId?: string | null;
  organizationRole?: PersonOrgRole;
};

export type UpdatePersonInput = Partial<
  Omit<CreatePersonInput, "bankId" | "createdByClerkUserId" | "organizationId" | "organizationRole">
> & {
  contactStatus?: ContactStatus;
  doNotContact?: boolean;
};

function personRow(bankId: string, input: CreatePersonInput) {
  return {
    bank_id: bankId,
    first_name: input.firstName ?? null,
    last_name: input.lastName ?? null,
    preferred_name: input.preferredName ?? null,
    email: input.email ?? null,
    phone: input.phone ?? null,
    mobile_phone: input.mobilePhone ?? null,
    job_title: input.jobTitle ?? null,
    linkedin_url: input.linkedinUrl ?? null,
    communication_preference: input.communicationPreference ?? null,
    relationship_owner_clerk_user_id: input.relationshipOwnerClerkUserId ?? null,
    notes: input.notes ?? null,
    created_by_clerk_user_id: input.createdByClerkUserId ?? null,
    // Backward-compat single-org pointer — only set at creation via the
    // convenience field; linkPersonToOrganization is the real multi-org path.
    organization_id: input.organizationId ?? null,
  };
}

export async function createPerson(input: CreatePersonInput, sb: SB = supabaseAdmin()): Promise<CrmPerson> {
  if (!input.firstName && !input.lastName && !input.email && !input.phone) {
    throw new Error("A person needs at least a name, email, or phone.");
  }

  const { data, error } = await sb
    .from("crm_people")
    .insert(personRow(input.bankId, input))
    .select("*")
    .single();

  if (error) throw new Error(`createPerson failed: ${error.message}`);
  const person = data as CrmPerson;

  if (input.organizationId) {
    await linkPersonToOrganization(
      {
        bankId: input.bankId,
        personId: person.id,
        organizationId: input.organizationId,
        role: input.organizationRole ?? "contact",
        isPrimaryContact: true,
      },
      sb,
    );
  }

  return person;
}

export async function updatePerson(
  bankId: string,
  personId: string,
  patch: UpdatePersonInput,
  sb: SB = supabaseAdmin(),
): Promise<CrmPerson> {
  const row: Record<string, unknown> = {};
  if (patch.firstName !== undefined) row.first_name = patch.firstName;
  if (patch.lastName !== undefined) row.last_name = patch.lastName;
  if (patch.preferredName !== undefined) row.preferred_name = patch.preferredName;
  if (patch.email !== undefined) row.email = patch.email;
  if (patch.phone !== undefined) row.phone = patch.phone;
  if (patch.mobilePhone !== undefined) row.mobile_phone = patch.mobilePhone;
  if (patch.jobTitle !== undefined) row.job_title = patch.jobTitle;
  if (patch.linkedinUrl !== undefined) row.linkedin_url = patch.linkedinUrl;
  if (patch.communicationPreference !== undefined) row.communication_preference = patch.communicationPreference;
  if (patch.relationshipOwnerClerkUserId !== undefined) row.relationship_owner_clerk_user_id = patch.relationshipOwnerClerkUserId;
  if (patch.notes !== undefined) row.notes = patch.notes;
  if (patch.contactStatus !== undefined) row.contact_status = patch.contactStatus;
  if (patch.doNotContact !== undefined) row.do_not_contact = patch.doNotContact;

  const { data, error } = await sb
    .from("crm_people")
    .update(row)
    .eq("id", personId)
    .eq("bank_id", bankId)
    .select("*")
    .single();

  if (error) throw new Error(`updatePerson failed: ${error.message}`);
  return data as CrmPerson;
}

export async function getPerson(bankId: string, personId: string, sb: SB = supabaseAdmin()): Promise<CrmPerson | null> {
  const { data, error } = await sb
    .from("crm_people")
    .select("*")
    .eq("id", personId)
    .eq("bank_id", bankId)
    .maybeSingle();

  if (error) throw new Error(`getPerson failed: ${error.message}`);
  return (data as CrmPerson) ?? null;
}

export async function recordContactAttempt(
  bankId: string,
  personId: string,
  kind: "contacted" | "responded",
  sb: SB = supabaseAdmin(),
): Promise<void> {
  const column = kind === "contacted" ? "last_contacted_at" : "last_response_at";
  const { error } = await sb
    .from("crm_people")
    .update({ [column]: new Date().toISOString() })
    .eq("id", personId)
    .eq("bank_id", bankId);
  if (error) throw new Error(`recordContactAttempt failed: ${error.message}`);
}

export async function linkPersonToOrganization(
  input: {
    bankId: string;
    personId: string;
    organizationId: string;
    role?: PersonOrgRole;
    jobTitle?: string | null;
    startDate?: string | null;
    isPrimaryContact?: boolean;
    isDecisionMaker?: boolean;
  },
  sb: SB = supabaseAdmin(),
): Promise<CrmPersonOrganizationRole> {
  if (input.isPrimaryContact) {
    // Only one primary contact per organization — demote any existing one
    // rather than allowing two rows to both claim it.
    await sb
      .from("crm_person_organization_roles")
      .update({ is_primary_contact: false })
      .eq("bank_id", input.bankId)
      .eq("organization_id", input.organizationId)
      .eq("is_primary_contact", true);
  }

  const { data, error } = await sb
    .from("crm_person_organization_roles")
    .insert({
      bank_id: input.bankId,
      person_id: input.personId,
      organization_id: input.organizationId,
      role: input.role ?? "contact",
      job_title: input.jobTitle ?? null,
      start_date: input.startDate ?? null,
      is_primary_contact: input.isPrimaryContact ?? false,
      is_decision_maker: input.isDecisionMaker ?? false,
    })
    .select("*")
    .single();

  if (error) throw new Error(`linkPersonToOrganization failed: ${error.message}`);
  return data as CrmPersonOrganizationRole;
}

export async function unlinkPersonFromOrganization(
  bankId: string,
  roleId: string,
  sb: SB = supabaseAdmin(),
): Promise<void> {
  // Soft — mark inactive + set end_date rather than delete, preserving
  // "when were they there" history.
  const { error } = await sb
    .from("crm_person_organization_roles")
    .update({ is_active: false, end_date: new Date().toISOString().slice(0, 10) })
    .eq("id", roleId)
    .eq("bank_id", bankId);
  if (error) throw new Error(`unlinkPersonFromOrganization failed: ${error.message}`);
}

export async function listOrganizationRolesForPerson(
  bankId: string,
  personId: string,
  sb: SB = supabaseAdmin(),
): Promise<CrmPersonOrganizationRole[]> {
  const { data, error } = await sb
    .from("crm_person_organization_roles")
    .select("*")
    .eq("bank_id", bankId)
    .eq("person_id", personId)
    .order("is_active", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listOrganizationRolesForPerson failed: ${error.message}`);
  return (data ?? []) as CrmPersonOrganizationRole[];
}

export async function listPeopleForOrganization(
  bankId: string,
  organizationId: string,
  sb: SB = supabaseAdmin(),
): Promise<Array<CrmPersonOrganizationRole & { person: CrmPerson }>> {
  const { data, error } = await sb
    .from("crm_person_organization_roles")
    .select("*, person:crm_people(*)")
    .eq("bank_id", bankId)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .order("is_primary_contact", { ascending: false });

  if (error) throw new Error(`listPeopleForOrganization failed: ${error.message}`);
  return (data ?? []) as unknown as Array<CrmPersonOrganizationRole & { person: CrmPerson }>;
}
