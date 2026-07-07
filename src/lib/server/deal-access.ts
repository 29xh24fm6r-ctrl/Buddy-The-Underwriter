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
import { dealAccessResultToError } from "./dealAccessResult";
import type { DealAccessResult } from "./dealAccessResult";

// Re-export the pure result type + status mapper (defined in a server-only-free
// module so the fail-closed matrix is unit testable). See dealAccessResult.ts.
export type { DealAccessResult } from "./dealAccessResult";
export { dealAccessResultToError } from "./dealAccessResult";

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
 * Throws typed AccessError on failure. Fails closed: any non-accessible
 * result (including an unexpected error swallowed by ensureDealBankAccess)
 * throws — the helper never returns on a denied path.
 * Use in routes where you want early-exit error handling.
 */
export async function assertDealAccess(
  dealId: string,
): Promise<{ dealId: string; bankId: string; userId: string }> {
  const result = await resolveDealAccess(dealId);

  if (!result.accessible) {
    // Non-null by construction: dealAccessResultToError only returns null for
    // an accessible result, which is excluded here.
    throw dealAccessResultToError(result)!;
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
