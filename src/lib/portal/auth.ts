// src/lib/portal/auth.ts
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sha256Base64url } from "@/lib/portal/token";

export type PortalInvite = {
  id: string;
  deal_id: string;
  bank_id: string;
  expires_at: string;
  revoked_at: string | null;
  name: string | null;
  email: string | null;
};

export async function requireValidInvite(token: string): Promise<PortalInvite> {
  const sb = supabaseAdmin();
  const tokenHash = sha256Base64url(token);

  const { data: invite, error } = await sb
    .from("borrower_invites")
    .select("id, deal_id, bank_id, expires_at, revoked_at, name, email")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !invite) throw new Error("Invalid link");
  if (invite.revoked_at) throw new Error("Link revoked");
  if (new Date(invite.expires_at).getTime() <= Date.now()) throw new Error("Link expired");

  return invite as PortalInvite;
}

/**
 * Validate a borrower invite token AND bind it to the deal being addressed.
 *
 * SPEC-SEC-INVITE-BIND-1. `requireValidInvite` only proves the caller holds
 * *some* live invite; it says nothing about which deal that invite is for.
 * Any route that takes a `dealId` from the URL and then queries with
 * `supabaseAdmin()` (service role — RLS does not apply) must use this
 * instead, or a borrower holding their own valid invite can address another
 * bank's deal.
 *
 * Throws "Link is not valid for this application" on mismatch; callers map
 * thrown errors to 400/401 as they already do for the other invite errors.
 */
export async function requireInviteForDeal(
  token: string,
  dealId: string,
): Promise<PortalInvite> {
  const invite = await requireValidInvite(token);
  if (invite.deal_id !== dealId) {
    console.warn("[requireInviteForDeal] invite/deal mismatch", {
      inviteDealId: invite.deal_id,
      requestedDealId: dealId,
    });
    throw new Error("Link is not valid for this application");
  }
  return invite;
}

/** Extracts a bearer token from an Authorization header value. */
export function bearerToken(headerValue: string | null | undefined): string {
  return String(headerValue ?? "").replace(/^Bearer\s+/i, "");
}
