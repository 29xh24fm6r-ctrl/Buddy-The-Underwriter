import { supabaseAdmin } from "@/lib/supabase/admin";
import { sha256Base64url } from "@/lib/portal/token";
import { getBorrowerSession } from "@/lib/brokerage/sessionToken";

export type PortalContext = {
  dealId: string;
  bankId: string;
};

/**
 * Canonical portal token resolver.
 * Uses existing borrower_invites table with token_hash (SHA256 base64url).
 * Single source of truth for all portal operations.
 * Aligns with existing portal auth system.
 */
export async function resolvePortalContext(token: string): Promise<PortalContext> {
  const sb = supabaseAdmin();

  // `/start` is authenticated by the HttpOnly buddy_borrower_session cookie
  // and intentionally does not expose the raw invite token to the browser.
  // Components shared with `/portal/[token]` therefore receive the selected
  // deal id. Accept that value only when it exactly matches the authenticated
  // session. This keeps one resolver for the shared borrower APIs without
  // weakening token auth or allowing a borrower to probe another deal.
  const session = await getBorrowerSession().catch(() => null);
  if (session?.deal_id === token) {
    return { dealId: session.deal_id, bankId: session.bank_id };
  }

  // Use existing token hash format (base64url, not hex)
  const tokenHash = sha256Base64url(token);

  const { data, error } = await sb
    .from("borrower_invites")
    .select("deal_id, bank_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) {
    // Legacy/parallel token store. `borrower_portal_links` predates
    // `borrower_invites` and is still what the upload routes issue against.
    // Checked here so there is ONE resolver for all borrower token auth
    // rather than each route hand-rolling its own lookup (which is how the
    // upload routes ended up rejecting self-serve `/start` borrowers).
    const { data: link } = await sb
      .from("borrower_portal_links")
      .select("deal_id, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (link?.deal_id) {
      if (link.expires_at && new Date(link.expires_at) < new Date()) {
        throw new Error("Invite expired");
      }
      const { data: deal } = await sb
        .from("deals")
        .select("bank_id")
        .eq("id", link.deal_id)
        .maybeSingle();
      if (deal?.bank_id) {
        return { dealId: link.deal_id, bankId: deal.bank_id };
      }
    }

    throw new Error("Invalid portal token");
  }
  if (data.revoked_at) throw new Error("Invite revoked");
  if (data.expires_at && new Date(data.expires_at) < new Date())
    throw new Error("Invite expired");

  return {
    dealId: data.deal_id,
    bankId: data.bank_id,
  };
}
