// src/lib/borrower/portalCompat.ts
/**
 * Canonical bridge between borrower portal and pack intelligence.
 * Single source of truth for portal context resolution.
 * Uses borrower_invites table with token_hash for authentication.
 */
import { supabaseAdmin } from "@/lib/supabase/admin";
import { sha256Base64url } from "@/lib/portal/token";

export type PortalContext = {
  inviteId: string;
  bankId: string;
  dealId: string;
};

/**
 * Resolves portal context from a token.
 * Validates token, expiration, and revocation status.
 * Returns null if invalid (graceful failure for API routes).
 */
export async function resolvePortalContextFromToken(token: string): Promise<PortalContext | null> {
  const sb = supabaseAdmin();

  // Your canonical portal table is borrower_invites with token_hash
  const tokenHash = sha256Base64url(token);

  const { data, error } = await sb
    .from("borrower_invites")
    .select("id, bank_id, deal_id, expires_at, revoked_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return null;
  if (data.expires_at && new Date(data.expires_at).getTime() < Date.now()) return null;

  return {
    inviteId: data.id,
    bankId: data.bank_id,
    dealId: data.deal_id,
  };
}

/**
 * Throws error if token is invalid (for use in routes that need hard failure).
 */
export async function requirePortalContext(token: string): Promise<PortalContext> {
  const context = await resolvePortalContextFromToken(token);
  if (!context) throw new Error("Invalid or expired portal link");
  return context;
}
