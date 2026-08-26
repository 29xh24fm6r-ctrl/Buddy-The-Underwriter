import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentBankId } from "@/lib/tenant/getCurrentBankId";

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
 * bank resolution, and an explicit deal-to-bank comparison. UUID audit fields
 * use profiles.id; Clerk IDs are never written into UUID columns.
 */
export async function resolveDealApiContext(
  dealId: string,
): Promise<DealApiContextResult> {
  const { userId: clerkUserId } = await clerkAuth();
  if (!clerkUserId) {
    return { ok: false, status: 401, error: "not_authenticated" };
  }

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

  const sb = supabaseAdmin();
  const [dealResult, profileResult] = await Promise.all([
    sb.from("deals").select("id, bank_id").eq("id", dealId).maybeSingle(),
    sb
      .from("profiles")
      .select("id")
      .eq("clerk_user_id", clerkUserId)
      .maybeSingle(),
  ]);

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

  if (profileResult.error) {
    console.error("[resolveDealApiContext] profile lookup failed", {
      dealId,
      clerkUserId,
      code: profileResult.error.code,
    });
    return { ok: false, status: 500, error: "profile_required" };
  }

  if (!profileResult.data?.id) {
    return { ok: false, status: 403, error: "profile_required" };
  }

  return {
    ok: true,
    sb,
    clerkUserId,
    actorProfileId: String(profileResult.data.id),
    dealId: String(dealResult.data.id),
    bankId: String(dealResult.data.bank_id),
  };
}
