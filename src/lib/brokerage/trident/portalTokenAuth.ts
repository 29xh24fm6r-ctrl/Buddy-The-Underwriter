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
 *   - Lookup hits borrower_portal_links by exact token match.
 *   - Expired links (expires_at < now) reject.
 *   - Revoked links (revoked_at set) reject — terminal, ahead of expiry.
 *   - All failure modes return null so the caller can surface a 404 (never
 *     403) — matches the leak-resistant pattern of the cookie routes.
 *
 * The generator and storage layer treat both auth surfaces identically
 * once a deal_id is bound to the request.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";

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
  const { data: link } = await client
    .from("borrower_portal_links")
    .select("deal_id, expires_at, revoked_at")
    .eq("token", token)
    .maybeSingle();

  if (!link?.deal_id) return null;
  // A revoked link is terminal. SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.3 added
  // borrower_portal_links.revoked_at precisely so a leaked or superseded URL
  // can be killed ahead of its expiry, and the sibling resolver in
  // /api/borrower/resolve already honours it. This resolver checked only
  // expires_at, so a revoked link still reached every borrower-portal Trident
  // surface it gates — preview generation, latest-preview, and the signed
  // download of the business plan, projections, and feasibility study.
  if (link.revoked_at) return null;
  if (
    link.expires_at &&
    new Date(link.expires_at as string).getTime() < Date.now()
  ) {
    return null;
  }

  return { token, dealId: link.deal_id as string };
}
