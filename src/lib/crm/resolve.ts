import "server-only";

/**
 * Party resolution domain service — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR1.
 *
 * Given a person or organization, resolve everything connected to it:
 * organization roles, deal roles, activities, and referred deals. This is
 * the shared read path both API routes and UI pages should use rather
 * than each re-deriving the same joins.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { listOrganizationRolesForPerson, type CrmPersonOrganizationRole } from "./people";
import { type ResolvedDealPartyRole } from "./partyRoles";
import type { SB } from "./types";

export type PartyActivity = {
  id: string;
  kind: string;
  happens_at: string;
  title: string | null;
  properties: Record<string, unknown>;
  due_at: string | null;
  completed_at: string | null;
};

export type ReferredDealSummary = {
  id: string;
  display_name: string | null;
  borrower_name: string | null;
  name: string | null;
  loan_amount: number | null;
  created_at: string;
};

export async function resolveDealRolesForPerson(bankId: string, personId: string, sb: SB = supabaseAdmin()): Promise<ResolvedDealPartyRole[]> {
  const { data, error } = await sb
    .from("deal_party_roles")
    .select("*, organization:crm_organizations(name)")
    .eq("bank_id", bankId)
    .eq("person_id", personId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`resolveDealRolesForPerson failed: ${error.message}`);
  return ((data ?? []) as any[]).map((row) => ({
    ...row,
    personName: null,
    organizationName: row.organization?.name ?? null,
    organization: undefined,
  })) as ResolvedDealPartyRole[];
}

export async function resolveDealRolesForOrganization(bankId: string, organizationId: string, sb: SB = supabaseAdmin()): Promise<ResolvedDealPartyRole[]> {
  const { data, error } = await sb
    .from("deal_party_roles")
    .select("*")
    .eq("bank_id", bankId)
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`resolveDealRolesForOrganization failed: ${error.message}`);
  return ((data ?? []) as any[]).map((row) => ({ ...row, personName: null, organizationName: null })) as ResolvedDealPartyRole[];
}

export async function resolveActivitiesForPerson(bankId: string, personId: string, limit = 100, sb: SB = supabaseAdmin()): Promise<PartyActivity[]> {
  const { data, error } = await sb
    .from("crm_activities")
    .select("id, kind, happens_at, title, properties, due_at, completed_at")
    .eq("bank_id", bankId)
    .eq("target_person_id", personId)
    .order("happens_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`resolveActivitiesForPerson failed: ${error.message}`);
  return (data ?? []) as PartyActivity[];
}

export async function resolveActivitiesForOrganization(bankId: string, organizationId: string, limit = 100, sb: SB = supabaseAdmin()): Promise<PartyActivity[]> {
  const { data: peopleIds } = await sb
    .from("crm_person_organization_roles")
    .select("person_id")
    .eq("bank_id", bankId)
    .eq("organization_id", organizationId);
  const personIds = (peopleIds ?? []).map((r: any) => r.person_id);

  const orFilter = [
    `target_organization_id.eq.${organizationId}`,
    personIds.length > 0 ? `target_person_id.in.(${personIds.join(",")})` : null,
  ]
    .filter(Boolean)
    .join(",");

  const { data, error } = await sb
    .from("crm_activities")
    .select("id, kind, happens_at, title, properties, due_at, completed_at")
    .eq("bank_id", bankId)
    .or(orFilter)
    .order("happens_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`resolveActivitiesForOrganization failed: ${error.message}`);
  return (data ?? []) as PartyActivity[];
}

export async function resolveDealsReferredByOrganization(bankId: string, organizationId: string, sb: SB = supabaseAdmin()): Promise<ReferredDealSummary[]> {
  const { data, error } = await sb
    .from("deals")
    .select("id, display_name, borrower_name, name, loan_amount, created_at")
    .eq("bank_id", bankId)
    .eq("referral_source_org_id", organizationId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`resolveDealsReferredByOrganization failed: ${error.message}`);
  return (data ?? []) as ReferredDealSummary[];
}

export type PersonRelationshipSummary = {
  organizationRoles: CrmPersonOrganizationRole[];
  dealRoles: ResolvedDealPartyRole[];
  activities: PartyActivity[];
};

/** Everything connected to one person, in one call — the shared read path for a person detail page. */
export async function resolvePersonRelationships(bankId: string, personId: string, sb: SB = supabaseAdmin()): Promise<PersonRelationshipSummary> {
  const [organizationRoles, dealRoles, activities] = await Promise.all([
    listOrganizationRolesForPerson(bankId, personId, sb),
    resolveDealRolesForPerson(bankId, personId, sb),
    resolveActivitiesForPerson(bankId, personId, 100, sb),
  ]);
  return { organizationRoles, dealRoles, activities };
}
