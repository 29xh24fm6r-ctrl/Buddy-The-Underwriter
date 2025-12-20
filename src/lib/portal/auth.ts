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
