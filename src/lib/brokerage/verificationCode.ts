/**
 * Pure 6-digit verification-code helpers — no server-only imports, no
 * request context, so these are trivially unit-testable in isolation from
 * emailVerification.ts's Supabase/email/session/next-headers dependencies.
 */

import crypto from "node:crypto";

export const VERIFICATION_CODE_LENGTH = 6;

/** SHA-256 hex of a raw code — never persist the raw code itself. */
export function hashVerificationCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/** Cryptographically random, zero-padded 6-digit code. */
export function generateVerificationCode(): string {
  return String(crypto.randomInt(0, 10 ** VERIFICATION_CODE_LENGTH)).padStart(
    VERIFICATION_CODE_LENGTH,
    "0",
  );
}
