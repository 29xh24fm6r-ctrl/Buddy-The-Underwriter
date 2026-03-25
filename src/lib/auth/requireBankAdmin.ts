import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { normalizeBuddyRole } from "@/lib/auth/normalizeBuddyRole";

/**
 * Verifies that the given Clerk user is an admin of the specified bank.
 * Throws an error with message "forbidden" if not.
 *
 * Accepts both legacy "admin" and canonical "bank_admin" membership roles.
 */
export async function requireBankAdmin(
  bankId: string,
  clerkUserId: string
): Promise<void> {
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("bank_memberships")
    .select("role")
    .eq("bank_id", bankId)
    .eq("clerk_user_id", clerkUserId)
    .maybeSingle();

  const normalized = normalizeBuddyRole(data?.role);
  if (!normalized || normalized !== "bank_admin") {
    throw new Error("forbidden");
  }
}
