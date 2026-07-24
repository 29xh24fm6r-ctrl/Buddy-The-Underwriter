import "server-only";
import { redirect } from "next/navigation";
import { ensureDealBankAccess } from "@/lib/tenant/ensureDealBankAccess";
import { getCurrentRole } from "@/lib/auth/requireRole";

/**
 * Access guard for deal-specific pages.
 *
 * Access is granted when ALL of the following are true:
 * 1. User is authenticated
 * 2. User belongs to the same bank as the deal (bank-level tenancy)
 * 3. User's role is NOT 'borrower' (borrowers access deals through the borrower portal only)
 *
 * This replaces requireRole() on all deal-specific pages. Role strings in Clerk
 * metadata should NEVER gate a banker from their own deal.
 *
 * Rule: if the URL has [dealId], use requireDealAccess.
 *       if it's a platform admin page with no deal context, use requireRole.
 */
export async function requireDealAccess(
  dealId: string,
): Promise<{ dealId: string; bankId: string; userId: string }> {
  const access = await ensureDealBankAccess(dealId);

  if (!access.ok) {
    if (access.error === "unauthorized") {
      redirect("/sign-in");
    }
    if (access.error === "deal_not_found") {
      redirect("/deals");
    }
    // tenant_mismatch — user is authenticated but wrong bank
    redirect("/deals");
  }

  // Borrowers never access deals through the bank application. This branch
  // has no known live path today — role="borrower" requires a Clerk user
  // metadata assignment that no code in this repo performs, and the
  // token-based invite flow (borrower_invites -> /portal/[token]) is the
  // one actually in use. Kept as a defensive guard in case that changes;
  // /start is the real borrower entry point, not the retired
  // (app)/borrower/portal tree this used to redirect to.
  const { role } = await getCurrentRole();
  if (role === "borrower") {
    redirect("/start");
  }

  return { dealId: access.dealId, bankId: access.bankId, userId: access.userId };
}
