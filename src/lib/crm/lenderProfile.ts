import type { SB } from "@/lib/crm/types";

/**
 * A bank is two rows: the crm_organizations identity and the
 * crm_lender_profiles credit box. Nothing kept them together, so an
 * organization could be typed 'lender' with no profile row — and the Bank
 * buyers workspace, which lists profiles, silently omitted it. Production
 * showed four organizations and two banks for exactly this reason
 * (Grasshopper Bank was typed as a lender and invisible).
 *
 * Every write that can make an organization a lender calls this, so the two
 * halves cannot disagree again. Idempotent by design: a bank that already
 * has a profile is left exactly as it is, appetite included.
 */
export async function ensureLenderProfile(
  sb: SB,
  bankId: string,
  organizationId: string,
  createdByClerkUserId: string | null,
): Promise<{ created: boolean }> {
  const { data: existing } = await sb
    .from("crm_lender_profiles")
    .select("id")
    .eq("bank_id", bankId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (existing) return { created: false };

  const { error } = await sb.from("crm_lender_profiles").insert({
    bank_id: bankId,
    organization_id: organizationId,
    relationship_status: "prospect",
    lender_type: "bank",
    sba_7a_appetite: false,
    sba_504_appetite: false,
    conventional_appetite: false,
    created_by_clerk_user_id: createdByClerkUserId,
  });

  // 23505 means a concurrent write won the race and the profile now exists,
  // which is the desired end state — not a failure to report to the caller.
  if (error && error.code !== "23505") {
    throw new Error(`ensureLenderProfile failed: ${error.message}`);
  }
  return { created: !error };
}
