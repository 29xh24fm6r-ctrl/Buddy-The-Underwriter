import "server-only";

/**
 * Lender identity resolution for the marketplace.
 *
 * Authentication/authorization absence is distinct from unavailable or
 * ambiguous authoritative state so HTTP routes never report an infrastructure
 * failure as a definitive 403.
 */

import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  type LenderIdentity,
  selectLenderIdentity,
} from "@/lib/brokerage/lenderIdentityBoundary";

export type { LenderIdentity } from "@/lib/brokerage/lenderIdentityBoundary";

export type LenderIdentityResolution =
  | { ok: true; identity: LenderIdentity }
  | {
      ok: false;
      reason:
        | "not_a_lender"
        | "identity_state_unavailable"
        | "ambiguous_lender_identity";
    };

export async function resolveLenderIdentityResult(): Promise<LenderIdentityResolution> {
  let userId: string | null = null;
  try {
    const auth = await clerkAuth();
    userId = auth.userId;
  } catch {
    return { ok: false, reason: "identity_state_unavailable" };
  }
  if (!userId) return { ok: false, reason: "not_a_lender" };

  const sb = supabaseAdmin();
  const { data: memberships, error: membershipError } = await sb
    .from("bank_memberships")
    .select("bank_id")
    .eq("clerk_user_id", userId)
    .limit(101);
  if (membershipError || !Array.isArray(memberships) || memberships.length > 100) {
    return { ok: false, reason: "identity_state_unavailable" };
  }

  const bankIds = Array.from(
    new Set(
      memberships
        .map((row: { bank_id?: unknown }) => row.bank_id)
        .filter((value): value is string => typeof value === "string" && Boolean(value.trim())),
    ),
  );
  if (bankIds.length === 0) return { ok: false, reason: "not_a_lender" };

  const { data: agreements, error: agreementError } = await sb
    .from("lender_marketplace_agreements")
    .select("lender_bank_id")
    .in("lender_bank_id", bankIds)
    .eq("status", "active")
    .order("lender_bank_id", { ascending: true })
    .limit(2);
  if (agreementError || !Array.isArray(agreements)) {
    return { ok: false, reason: "identity_state_unavailable" };
  }

  const selection = selectLenderIdentity(userId, memberships, agreements);
  if (selection.ok) return selection;
  if (selection.reason === "ambiguous_lender_identity") return selection;
  if (selection.reason === "not_a_lender") return selection;
  return { ok: false, reason: "identity_state_unavailable" };
}

/**
 * Compatibility wrapper for existing fail-closed callers. New HTTP boundaries
 * should use resolveLenderIdentityResult so unavailable state remains non-green.
 */
export async function resolveLenderIdentity(): Promise<LenderIdentity | null> {
  const result = await resolveLenderIdentityResult();
  return result.ok ? result.identity : null;
}
