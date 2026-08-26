import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";
import { resolveUserApiContext } from "@/lib/server/userApiContext";

export type DealApiContext = {
  ok: true;
  sb: SupabaseClient;
  clerkUserId: string;
  actorProfileId: string;
  dealId: string;
  bankId: string;
};

export type DealApiContextFailure = {
  ok: false;
  status: 401 | 403 | 404 | 500;
  error:
    | "not_authenticated"
    | "profile_required"
    | "profile_lookup_failed"
    | "bank_context_unavailable"
    | "deal_fetch_failed"
    | "deal_not_found"
    | "wrong_bank";
};

export type DealApiContextResult = DealApiContext | DealApiContextFailure;

/**
 * Canonical Clerk-authenticated context for JSON deal routes.
 *
 * Database work uses the service-role client only after Clerk authentication,
 * profile resolution, bank resolution, and an explicit deal-to-bank comparison.
 */
export async function resolveDealApiContext(
  dealId: string,
): Promise<DealApiContextResult> {
  const user = await resolveUserApiContext();
  if (!user.ok) return user;

  const { sb, clerkUserId, actorProfileId } = user;

  let bankId: string;
  try {
    bankId = await getCurrentBankId();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const forbidden =
      message === "no_memberships" ||
      message === "multiple_memberships" ||
      message === "bank_selection_required" ||
      message === "sandbox_forbidden";

    console.warn("[resolveDealApiContext] bank context unavailable", {
      dealId,
      clerkUserId,
      reason: message,
    });

    return {
      ok: false,
      status: forbidden ? 403 : 500,
      error: "bank_context_unavailable",
    };
  }

  const dealResult = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("id", dealId)
    .maybeSingle();

  if (dealResult.error) {
    console.error("[resolveDealApiContext] deal lookup failed", {
      dealId,
      clerkUserId,
      code: dealResult.error.code,
    });
    return { ok: false, status: 500, error: "deal_fetch_failed" };
  }

  if (!dealResult.data) {
    return { ok: false, status: 404, error: "deal_not_found" };
  }

  if (String(dealResult.data.bank_id) !== String(bankId)) {
    console.warn("[resolveDealApiContext] tenant mismatch", {
      dealId,
      clerkUserId,
      userBankId: bankId,
      dealBankId: dealResult.data.bank_id,
    });
    return { ok: false, status: 403, error: "wrong_bank" };
  }

  return {
    ok: true,
    sb,
    clerkUserId,
    actorProfileId,
    dealId: String(dealResult.data.id),
    bankId: String(dealResult.data.bank_id),
  };
}
