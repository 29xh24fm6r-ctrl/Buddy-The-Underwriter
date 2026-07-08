import "server-only";

/**
 * Lender identity resolution for the marketplace.
 *
 * A "lender" is a Clerk user who is a member of a bank that holds an ACTIVE
 * lender_marketplace_agreement. Middleware (src/proxy.ts) does not gate /api/**,
 * so every lender marketplace route calls resolveLenderIdentity() first and 403s
 * when it returns null. Lenders are cross-tenant by design (they browse listings
 * across borrower banks), so there is no per-deal tenant check — access is scoped
 * instead by (a) being matched to a listing and (b) an explicit package_access row.
 */

import { clerkAuth } from "@/lib/auth/clerkServer";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type LenderIdentity = { userId: string; lenderBankId: string };

export async function resolveLenderIdentity(): Promise<LenderIdentity | null> {
  let userId: string | null = null;
  try {
    const auth = await clerkAuth();
    userId = auth.userId;
  } catch {
    return null; // fail closed
  }
  if (!userId) return null;

  const sb = supabaseAdmin();
  const { data: mems } = await sb
    .from("bank_memberships")
    .select("bank_id")
    .eq("clerk_user_id", userId);
  const bankIds = Array.from(
    new Set(((mems ?? []) as any[]).map((m) => m.bank_id).filter(Boolean)),
  );
  if (bankIds.length === 0) return null;

  const { data: agr } = await sb
    .from("lender_marketplace_agreements")
    .select("lender_bank_id")
    .in("lender_bank_id", bankIds)
    .eq("status", "active")
    .limit(1)
    .maybeSingle();
  if (!agr) return null;

  return { userId, lenderBankId: (agr as any).lender_bank_id };
}
