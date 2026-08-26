import "server-only";

/**
 * Application Chooser Session — post-OTP, pre-deal-selection identity proof
 * for every borrower (generalizes the existing QA-only chooser cookie in
 * qaChooser.ts to the general case).
 *
 * When a verified email has one or more prior deals, the borrower must be
 * given an explicit choice (resume / view / start new) rather than being
 * silently reattached. This signed, short-lived cookie proves "this browser
 * just verified this email for this bank" and authorizes listing existing
 * applications and creating/resuming/viewing one — without binding a full
 * deal-scoped session until the borrower actually chooses.
 *
 * Once a choice is made, the normal createBorrowerSession() path sets
 * buddy_borrower_session, superseding this cookie.
 *
 * Security (identical posture to qaChooser.ts):
 *   - HMAC-SHA256 signed with a server-side secret
 *   - HTTP-only, Secure, SameSite=Lax
 *   - Short-lived (10 minutes) — only needs to survive from OTP to choice
 *   - Payload carries email + bankId (both already known server-side at
 *     verification time) so the applications-list/choice endpoints never
 *     need to trust a client-supplied email or bank.
 */

import { cookies } from "next/headers";
import { getChooserSigningKey } from "@/lib/brokerage/chooserSigningKey";
import { signChooserPayload, verifyChooserPayload } from "@/lib/brokerage/chooserToken";

const COOKIE_NAME = "buddy_application_chooser";
const COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes

function sign(email: string, bankId: string, expiresAt: number): string {
  return signChooserPayload(
    `${email}:${bankId}:${expiresAt}`,
    getChooserSigningKey(),
  );
}

function verify(token: string): { email: string; bankId: string; expiresAt: number } | null {
  const payload = verifyChooserPayload(token, getChooserSigningKey());
  if (!payload) return null;

  const parts = payload.split(":");
  if (parts.length !== 3) return null;

  const [email, bankId, expiresAtRaw] = parts;
  const expiresAt = Number.parseInt(expiresAtRaw, 10);
  if (!email || !bankId || !Number.isFinite(expiresAt)) return null;

  return { email, bankId, expiresAt };
}

/**
 * Set the application-chooser identity cookie, proving the bearer just
 * verified this email for this bank via OTP.
 */
export async function setApplicationChooserCookie(email: string, bankId: string): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS;
  const token = sign(email.toLowerCase().trim(), bankId, expiresAt);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: "/",
  });
}

/**
 * Read and validate the application-chooser identity cookie.
 * Returns the verified email + bankId, or null if missing, expired, or
 * invalid — callers must fail closed on null.
 */
export async function getApplicationChooserIdentity(): Promise<
  { email: string; bankId: string } | null
> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const result = verify(raw);
  if (!result) return null;
  if (result.expiresAt < Math.floor(Date.now() / 1000)) return null;

  return { email: result.email, bankId: result.bankId };
}

/**
 * Invalidate the application-chooser cookie (called after a real borrower
 * session is created for the chosen or newly-created deal).
 */
export async function clearApplicationChooserCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}
