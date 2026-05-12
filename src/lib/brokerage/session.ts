import "server-only";

/**
 * Borrower session — spec-shaped facade over the existing token-handling
 * helper in `sessionToken.ts`.
 *
 * Spec: specs/brokerage/SPEC-BROKERAGE-PRODUCTIONIZATION-V1.md §Phase 2.
 *
 * Security invariants (enforced by the underlying primitive):
 *   - Raw token lives ONLY in the HTTP-only cookie `buddy_borrower_session`.
 *   - DB stores SHA-256 of the token (token_hash is the PK).
 *   - Lookups hash the incoming cookie before comparing.
 *   - Sessions expire (90 days); expired sessions are NOT reused — a new
 *     one is minted in their place.
 *   - The raw token is never logged.
 *
 * This module is the spec-named entry point. It does not re-implement the
 * security primitive — it composes the audited `sessionToken.ts` helper
 * (which already has unit tests, including a server-only/next-headers
 * mock) and exposes the exact surface the spec calls for:
 *
 *   - getOrCreateBorrowerSession()
 *   - getBorrowerSessionFromRequest()
 *   - hashBorrowerSessionToken(rawToken)
 */

import crypto from "node:crypto";

import {
  getBorrowerSession,
  createBorrowerSession,
  type BorrowerSession,
} from "./sessionToken";
import { getBrokerageBankId } from "@/lib/tenant/brokerage";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type BrokerageBorrowerSession = BorrowerSession;

/**
 * Resolve the current borrower session from the HTTP-only cookie, or
 * create a new anonymous one (and a draft brokerage deal to anchor it).
 *
 * Idempotent within a request: if a valid cookie is present and the
 * matching DB row is unexpired, the existing session is returned. Only
 * when both are absent or stale do we mint a fresh token and deal.
 */
export async function getOrCreateBorrowerSession(): Promise<BrokerageBorrowerSession> {
  const existing = await getBorrowerSession();
  if (existing) return existing;

  const brokerageBankId = await getBrokerageBankId();
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deals")
    .insert({
      bank_id: brokerageBankId,
      deal_type: "SBA",
      origin: "brokerage_anonymous",
      display_name: "New borrower inquiry",
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(
      `Failed to create draft brokerage deal: ${error?.message ?? "unknown"}`,
    );
  }

  const created = await createBorrowerSession({
    dealId: data.id,
    bankId: brokerageBankId,
  });

  return {
    rawToken: created.rawToken,
    tokenHash: created.tokenHash,
    deal_id: data.id,
    bank_id: brokerageBankId,
    claimed_email: null,
    claimed_at: null,
  };
}

/**
 * Read-only variant — returns the current session if one is valid in the
 * cookie, or `null` otherwise. Does NOT mint a new session. Use this in
 * API handlers that must not have the side effect of creating a deal
 * (e.g. status polling, lookups).
 */
export async function getBorrowerSessionFromRequest(): Promise<BrokerageBorrowerSession | null> {
  return getBorrowerSession();
}

/**
 * Deterministic SHA-256 of a raw session token, hex-encoded. Exposed for
 * unit tests and for code paths that must compare a known token to the
 * DB-stored hash without re-implementing the digest.
 */
export function hashBorrowerSessionToken(rawToken: string): string {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}
