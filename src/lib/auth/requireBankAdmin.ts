import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";

/**
 * Verifies that the given Clerk user is an admin of the specified bank.
 * Throws an error with message "forbidden" if not.
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

  if (!data || data.role !== "admin") {
    throw new Error("forbidden");
  }
}
