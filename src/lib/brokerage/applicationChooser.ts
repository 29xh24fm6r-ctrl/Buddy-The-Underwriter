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
import crypto from "node:crypto";

const COOKIE_NAME = "buddy_application_chooser";
const COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes

function getSigningKey(): string {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "buddy-application-chooser-dev-key"
  );
}

function sign(email: string, bankId: string, expiresAt: number): string {
  const payload = `${email}:${bankId}:${expiresAt}`;
  const hmac = crypto.createHmac("sha256", getSigningKey());
  hmac.update(payload);
  const signature = hmac.digest("hex");
  return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}

function verify(token: string): { email: string; bankId: string; expiresAt: number } | null {
  const dotIdx = token.lastIndexOf(".");
  if (dotIdx <= 0) return null;

  const payloadB64 = token.slice(0, dotIdx);
  const providedSig = token.slice(dotIdx + 1);

  let payload: string;
  try {
    payload = Buffer.from(payloadB64, "base64url").toString("utf-8");
  } catch {
    return null;
  }

  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  const [email, bankId, expiresAtRaw] = parts;
  const expiresAt = parseInt(expiresAtRaw, 10);
  if (!email || !bankId || isNaN(expiresAt)) return null;

  const hmac = crypto.createHmac("sha256", getSigningKey());
  hmac.update(payload);
  const expectedSig = hmac.digest("hex");

  if (providedSig.length !== expectedSig.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))) {
    return null;
  }

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
