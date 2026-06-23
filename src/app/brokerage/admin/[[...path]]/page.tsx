import "server-only";

import { redirect } from "next/navigation";

/**
 * /brokerage/admin — clean admin entry from buddysba.com.
 *
 * Two facts make this route necessary:
 *   1. The Clerk production instance is domain-locked to
 *      app.buddytheunderwriter.com, so /admin and /sign-in render broken
 *      on buddysba.com (ClerkJS refuses to initialize off-domain).
 *   2. The middleware public-route matcher already opens "/brokerage(.*)"
 *      — so this page runs unauthenticated on any domain, unlike paths
 *      outside that namespace which get bounced to the broken sign-in
 *      before they can redirect.
 *
 * Result:
 *   buddysba.com/brokerage/admin                     → admin lender control center
 *   buddysba.com/brokerage/admin/brokerage/listings  → brokerage ops dashboard
 *   buddysba.com/brokerage/admin/<anything>          → app domain /admin/<anything>
 *
 * Clerk handles sign-in on the canonical admin host if needed, then
 * returns the user to the requested page.
 */

const ADMIN_ORIGIN = "https://app.buddytheunderwriter.com";

export const dynamic = "force-dynamic";

export default async function BrokerageAdminGateway({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path } = await params;
  const suffix =
    path && path.length > 0 ? `/${path.join("/")}` : "/brokerage/lenders";
  redirect(`${ADMIN_ORIGIN}/admin${suffix}`);
}
