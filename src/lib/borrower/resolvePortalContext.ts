import { supabaseAdmin } from "@/lib/supabase/admin";
import { sha256Base64url } from "@/lib/portal/token";

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

  // Use existing token hash format (base64url, not hex)
  const tokenHash = sha256Base64url(token);

  const { data, error } = await sb
    .from("borrower_invites")
    .select("deal_id, bank_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) throw new Error("Invalid portal token");
  if (data.revoked_at) throw new Error("Invite revoked");
  if (data.expires_at && new Date(data.expires_at) < new Date())
    throw new Error("Invite expired");

  return {
    dealId: data.deal_id,
    bankId: data.bank_id,
  };
}
