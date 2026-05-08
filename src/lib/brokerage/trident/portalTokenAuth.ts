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
 *   - All failure modes return null so the caller can surface a 404 (never
 *     403) — matches the leak-resistant pattern of the cookie routes.
 *
 * The generator and storage layer treat both auth surfaces identically
 * once a deal_id is bound to the request.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type PortalTokenContext = {
  token: string;
  dealId: string;
};

export async function resolvePortalToken(
  token: string,
  sb?: SupabaseClient,
): Promise<PortalTokenContext | null> {
  if (!token || typeof token !== "string") return null;

  const client = sb ?? supabaseAdmin();
  const { data: link } = await client
    .from("borrower_portal_links")
    .select("deal_id, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!link?.deal_id) return null;
  if (
    link.expires_at &&
    new Date(link.expires_at as string).getTime() < Date.now()
  ) {
    return null;
  }

  return { token, dealId: link.deal_id as string };
}
