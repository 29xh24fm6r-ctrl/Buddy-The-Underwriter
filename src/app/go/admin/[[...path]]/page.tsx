import "server-only";

import { redirect } from "next/navigation";

/**
 * /go/admin — clean admin entry from any Buddy domain.
 *
 * The Clerk production instance is domain-locked to
 * app.buddytheunderwriter.com, so authentication can only happen there —
 * visiting /admin or /sign-in on buddysba.com renders a broken page
 * because ClerkJS refuses to initialize off-domain.
 *
 * This gateway gives every domain a clean entry anyway:
 *
 *   buddysba.com/go/admin                       → admin lender control center
 *   buddysba.com/go/admin/brokerage/listings    → brokerage ops dashboard
 *   buddysba.com/go/admin/<anything>            → app domain /admin/<anything>
 *
 * The redirect lands on the canonical admin host; Clerk handles sign-in
 * there if needed and returns the user to the requested page.
 */

const ADMIN_ORIGIN = "https://app.buddytheunderwriter.com";

export const dynamic = "force-dynamic";

export default async function GoAdminGateway({
  params,
}: {
  params: Promise<{ path?: string[] }>;
}) {
  const { path } = await params;
  const suffix =
    path && path.length > 0 ? `/${path.join("/")}` : "/brokerage/lenders";
  redirect(`${ADMIN_ORIGIN}/admin${suffix}`);
}
