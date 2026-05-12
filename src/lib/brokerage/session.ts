import "server-only";

/**
 * Borrower session — spec-shaped facade over the existing token-handling
 * helper in `sessionToken.ts`.
 *
 * Spec: specs/brokerage/SPEC-BROKERAGE-PRODUCTIONIZATION-V1.md §Phase 2.
 * Updated: SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.1 — single source of
 * truth for draft-deal creation; calls claim_brokerage_session() so the
 * advisory-lock + partial-unique safety net is honored.
 *
 * Security invariants (enforced by the underlying primitive):
 *   - Raw token lives ONLY in the HTTP-only cookie `buddy_borrower_session`.
 *   - DB stores SHA-256 of the token (token_hash is the PK).
 *   - Lookups hash the incoming cookie before comparing.
 *   - Sessions expire (90 days); expired sessions are NOT reused — a new
 *     one is minted in their place.
 *   - The raw token is never logged.
 *
 * Surface (unchanged from PRODUCTIONIZATION-V1 §Phase 2):
 *
 *   - getOrCreateBorrowerSession()
 *   - getBorrowerSessionFromRequest()
 *   - hashBorrowerSessionToken(rawToken)
 */

import crypto from "node:crypto";
import { cookies } from "next/headers";

import {
  getBorrowerSession,
  type BorrowerSession,
} from "./sessionToken";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type BrokerageBorrowerSession = BorrowerSession;

const COOKIE_NAME = "buddy_borrower_session";
const COOKIE_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

/**
 * Resolve the current borrower session from the HTTP-only cookie, or
 * create a new anonymous one (and a draft brokerage deal to anchor it).
 *
 * Concurrency: the create path goes through claim_brokerage_session(),
 * which takes a per-tenant pg_advisory_xact_lock and rechecks the token
 * inside the lock. Two parallel cookie-less requests will serialize on
 * the lock; if they happen to generate distinct tokens they each create
 * distinct sessions (correct), but a single retry burst sharing the
 * same token hash will produce exactly one deal.
 */
export async function getOrCreateBorrowerSession(): Promise<BrokerageBorrowerSession> {
  const existing = await getBorrowerSession();
  if (existing) return existing;

  const brokerageBankId = await getBrokerageBankId();
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = hashBorrowerSessionToken(rawToken);

  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("claim_brokerage_session", {
    p_bank_id: brokerageBankId,
    p_token_hash: tokenHash,
  });

  if (error || !data) {
    throw new Error(
      `claim_brokerage_session failed: ${error?.message ?? "unknown"}`,
    );
  }

  const dealId = (data as { deal_id?: string }).deal_id;
  if (!dealId) {
    throw new Error("claim_brokerage_session returned no deal_id");
  }

  // Set the cookie so the borrower's next request resolves to the same
  // session. Server-only — never read by the client.
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });

  return {
    rawToken,
    tokenHash,
    deal_id: dealId,
    bank_id: brokerageBankId,
    claimed_email: null,
    claimed_at: null,
  };
}

/**
 * Read-only variant — returns the current session if one is valid in the
 * cookie, or `null` otherwise. Does NOT mint a new session.
 */
export async function getBorrowerSessionFromRequest(): Promise<BrokerageBorrowerSession | null> {
  return getBorrowerSession();
}

/**
 * Deterministic SHA-256 of a raw session token, hex-encoded.
 */
export function hashBorrowerSessionToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
