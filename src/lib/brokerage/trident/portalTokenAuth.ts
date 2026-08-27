import "server-only";

/**
 * Portal-token authentication for the borrower-facing trident routes.
 *
 * Why a separate helper: the borrower portal at /portal/[token] uses URL
 * token auth via borrower_portal_links — NOT the buddy_borrower_session
 * cookie that the brokerage `/start` concierge surface uses. Both surfaces
 * need to call the same trident generator and storage, but the auth
 * primitive differs.
 *
 * Security shape:
 *   - The token comes from the route segment (server-side), never from a
 *     client request body.
 *   - Lookup uses the authoritative portal-link state-machine RPC.
 *   - Expired, revoked, and consumed single-use links reject consistently.
 *   - All failure modes return null so the caller can surface a 404 (never
 *     403) — matches the leak-resistant pattern of the cookie routes.
 *
 * The generator and storage layer treat both auth surfaces identically
 * once a deal_id is bound to the request.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";
import { peekBorrowerPortalLink } from "@/lib/portal/portalLinkState";

export type PortalTokenContext = {
  token: string;
  dealId: string;
};

export async function resolvePortalToken(
  token: string,
  sb?: SupabaseClient,
): Promise<PortalTokenContext | null> {
  if (!token || typeof token !== "string") return null;

  // Shared Trident UI is rendered from both `/portal/[token]` and the
  // cookie-authenticated `/start` workspace. `/start` never receives the raw
  // portal token, so it passes its selected deal id. Permit that form only
  // when the HttpOnly borrower session proves the exact same deal.
  const session = await getBorrowerSession().catch(() => null);
  if (session?.deal_id === token) {
    return { token, dealId: session.deal_id };
  }

  const client = sb ?? supabaseAdmin();
  try {
    const link = await peekBorrowerPortalLink(token, client);
    return { token, dealId: link.deal_id };
  } catch {
    // Preserve the leak-resistant contract: callers surface every invalid,
    // expired, revoked, consumed, or indeterminate token as a 404.
    return null;
  }
}
