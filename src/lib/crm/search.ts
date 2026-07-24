import "server-only";

/**
 * Global CRM search — SPEC-BROKERAGE-OPERATING-SYSTEM-V1 PR1 §3.3.
 *
 * Simple `ilike` search across organizations and people, scoped to the
 * caller's bank. Not full-text/fuzzy — deliberately simple and honest
 * about what it does, matching this codebase's "no fabricated capability"
 * principle. Excludes merged (soft-deleted) records.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import type { CrmOrganization } from "./organizations";
import type { CrmPerson } from "./people";
import type { SB } from "./types";

export type CrmSearchResult = {
  organizations: CrmOrganization[];
  people: CrmPerson[];
};

export async function searchCrm(bankId: string, query: string, limit = 20, sb: SB = supabaseAdmin()): Promise<CrmSearchResult> {
  const q = query.trim();
  if (!q) return { organizations: [], people: [] };

  const pattern = `%${q}%`;

  const [{ data: orgs, error: orgErr }, { data: people, error: peopleErr }] = await Promise.all([
    sb
      .from("crm_organizations")
      .select("*")
      .eq("bank_id", bankId)
      .is("merged_into_id", null)
      .ilike("name", pattern)
      .limit(limit),
    sb
      .from("crm_people")
      .select("*")
      .eq("bank_id", bankId)
      .is("merged_into_id", null)
      .or(`first_name.ilike.${pattern},last_name.ilike.${pattern},email.ilike.${pattern},phone.ilike.${pattern}`)
      .limit(limit),
  ]);

  if (orgErr) throw new Error(`searchCrm organizations failed: ${orgErr.message}`);
  if (peopleErr) throw new Error(`searchCrm people failed: ${peopleErr.message}`);

  return {
    organizations: (orgs ?? []) as CrmOrganization[],
    people: (people ?? []) as CrmPerson[],
  };
}
