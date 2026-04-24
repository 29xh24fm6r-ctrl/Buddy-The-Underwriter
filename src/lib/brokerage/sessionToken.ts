import "server-only";

/**
 * Borrower session-token helper. Security-critical.
 *
 * Raw token lives ONLY in the HTTP-only cookie `buddy_borrower_session`.
 * Database stores SHA-256 hash (token_hash is the PK). Lookups hash the
 * incoming cookie before comparing. See master plan §3a.
 *
 * A database breach (backup theft, replica leak, log exfiltration) must
 * not give attackers live session tokens they can replay.
 */

import { cookies } from "next/headers";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";

const COOKIE_NAME = "buddy_borrower_session";
const COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export type BorrowerSession = {
  rawToken: string;
  tokenHash: string;
  deal_id: string;
  bank_id: string;
  claimed_email: string | null;
  claimed_at: string | null;
};

function hashToken(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex");
}

export async function getBorrowerSession(): Promise<BorrowerSession | null> {
  const cookieStore = await cookies();
  const rawToken = cookieStore.get(COOKIE_NAME)?.value;
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);
  const sb = supabaseAdmin();
  const { data } = await sb
    .from("borrower_session_tokens")
    .select(
      "token_hash, deal_id, bank_id, claimed_email, claimed_at, expires_at",
    )
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (!data) return null;
  if (new Date(data.expires_at) < new Date()) return null;

  // Async touch — non-fatal.
  sb.from("borrower_session_tokens")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("token_hash", tokenHash)
    .then(() => {});

  return {
    rawToken,
    tokenHash: data.token_hash,
    deal_id: data.deal_id,
    bank_id: data.bank_id,
    claimed_email: data.claimed_email,
    claimed_at: data.claimed_at,
  };
}

export async function createBorrowerSession(args: {
  dealId: string;
  bankId: string;
}): Promise<{ rawToken: string; tokenHash: string }> {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);

  const sb = supabaseAdmin();
  await sb.from("borrower_session_tokens").insert({
    token_hash: tokenHash,
    deal_id: args.dealId,
    bank_id: args.bankId,
  });

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });

  return { rawToken, tokenHash };
}

export async function claimBorrowerSession(args: {
  tokenHash: string;
  email: string;
}): Promise<void> {
  const sb = supabaseAdmin();
  const { data: tokenRow } = await sb
    .from("borrower_session_tokens")
    .select("deal_id")
    .eq("token_hash", args.tokenHash)
    .single();
  if (!tokenRow?.deal_id) return;

  await sb
    .from("borrower_session_tokens")
    .update({
      claimed_email: args.email,
      claimed_at: new Date().toISOString(),
    })
    .eq("token_hash", args.tokenHash);

  await sb
    .from("deals")
    .update({ borrower_email: args.email, origin: "brokerage_claimed" })
    .eq("id", tokenRow.deal_id);
}

// Exported for unit testing only. Consumers of this module must never
// persist or transmit anything other than the hash.
export const __test_hashToken = hashToken;
