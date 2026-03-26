import "server-only";

/**
 * Phase 53B — Deal Access Resolution
 *
 * Server-side deal access helpers that derive access from the current
 * authenticated context. Never trusts caller-supplied bankId.
 *
 * Delegates to existing ensureDealBankAccess for the actual tenant check.
 */

import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { DealAccessDeniedError, AuthenticationRequiredError } from "./access-errors";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DealAccessResult =
  | {
      accessible: true;
      dealId: string;
      bankId: string;
      userId: string;
      source: "membership";
    }
  | {
      accessible: false;
      reason: "not_found" | "deal_not_found" | "tenant_mismatch" | "unauthorized";
      detail?: string;
    };

// ---------------------------------------------------------------------------
// resolveDealAccess — non-throwing, returns result object
// ---------------------------------------------------------------------------

/**
 * Resolve whether the current user can access a deal.
 * Never trusts caller-supplied bankId — derives from server auth context.
 * Returns a result object (does not throw).
 */
export async function resolveDealAccess(dealId: string): Promise<DealAccessResult> {
  const result = await ensureDealBankAccess(dealId);

  if (!result.ok) {
    return {
      accessible: false,
      reason: result.error,
      detail: (result as any).detail,
    };
  }

  return {
    accessible: true,
    dealId: result.dealId,
    bankId: result.bankId,
    userId: result.userId,
    source: "membership",
  };
}

// ---------------------------------------------------------------------------
// assertDealAccess — throwing variant for routes that want early exit
// ---------------------------------------------------------------------------

/**
 * Assert the current user can access a deal.
 * Throws typed AccessError on failure.
 * Use in routes where you want early-exit error handling.
 */
export async function assertDealAccess(
  dealId: string,
): Promise<{ dealId: string; bankId: string; userId: string }> {
  const result = await resolveDealAccess(dealId);

  if (!result.accessible) {
    if (result.reason === "unauthorized") {
      throw new AuthenticationRequiredError(result.detail);
    }
    const isNotFound = result.reason === "not_found" || result.reason === "deal_not_found";
    throw new DealAccessDeniedError(
      isNotFound ? "not_found" : "tenant_mismatch",
      result.detail,
    );
  }

  return {
    dealId: result.dealId,
    bankId: result.bankId,
    userId: result.userId,
  };
}

// ---------------------------------------------------------------------------
// resolveDealBankId — lightweight bank lookup for a deal
// ---------------------------------------------------------------------------

/**
 * Look up the bank_id for a deal without full access verification.
 * Use only in internal/system contexts where auth is already verified.
 * Returns null if deal not found.
 */
export async function resolveDealBankId(dealId: string): Promise<string | null> {
  const sb = supabaseAdmin();
  const { data: deal } = await sb
    .from("deals")
    .select("bank_id")
    .eq("id", dealId)
    .maybeSingle();

  return deal?.bank_id ?? null;
}
