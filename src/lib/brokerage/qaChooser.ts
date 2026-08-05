import "server-only";

/**
 * QA Chooser Session — post-OTP, pre-deal-selection QA identity proof.
 *
 * When a QA borrower verifies their OTP but cannot be bound to a test deal
 * (because no existing test deal exists, or the lead lookup would return a
 * non-test deal), a signed, short-lived QA identity cookie is set instead of
 * a deal-bound session-token row. This cookie proves "this browser
 * just successfully verified the QA email" and authorizes listing and
 * creating QA test applications — without requiring a pre-existing deal.
 *
 * Once a test application is created or resumed, the normal
 * createBorrowerSession() path sets buddy_borrower_session, superseding this
 * cookie.
 *
 * Security:
 *   - HMAC-SHA256 signed with a server-side secret
 *   - HTTP-only, Secure, SameSite=Lax
 *   - Short-lived (10 minutes) — only needs to survive from OTP to first
 *     application selection
 *   - No PII in the token value — just the email (already known server-side)
 */

import { cookies } from "next/headers";
import crypto from "node:crypto";

const COOKIE_NAME = "buddy_qa_chooser";
const COOKIE_MAX_AGE_SECONDS = 10 * 60; // 10 minutes

function getSigningKey(): string {
  // Derive a stable key from env vars available server-side.
  // In production this is the Supabase service role key; in CI/development
  // it falls back to a fixed key (only the QA email is signed, so exposure
  // risk is minimal).
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "buddy-qa-chooser-dev-key"
  );
}

function sign(email: string, expiresAt: number): string {
  const payload = `${email}:${expiresAt}`;
  const hmac = crypto.createHmac("sha256", getSigningKey());
  hmac.update(payload);
  const signature = hmac.digest("hex");
  return `${Buffer.from(payload).toString("base64url")}.${signature}`;
}

function verify(token: string): { email: string; expiresAt: number } | null {
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

  const colonIdx = payload.lastIndexOf(":");
  if (colonIdx <= 0) return null;

  const email = payload.slice(0, colonIdx);
  const expiresAt = parseInt(payload.slice(colonIdx + 1), 10);
  if (!email || isNaN(expiresAt)) return null;

  // Verify HMAC
  const hmac = crypto.createHmac("sha256", getSigningKey());
  hmac.update(payload);
  const expectedSig = hmac.digest("hex");

  // Constant-time comparison to avoid timing attacks
  if (!crypto.timingSafeEqual(Buffer.from(providedSig), Buffer.from(expectedSig))) {
    return null;
  }

  return { email, expiresAt };
}

/**
 * Set the QA chooser identity cookie, proving the bearer just verified the
 * QA email via OTP.
 */
export async function setQAChooserCookie(email: string): Promise<void> {
  const expiresAt = Math.floor(Date.now() / 1000) + COOKIE_MAX_AGE_SECONDS;
  const token = sign(email.toLowerCase().trim(), expiresAt);

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
 * Read and validate the QA chooser identity cookie.
 * Returns the verified QA email, or null if missing, expired, or invalid.
 */
export async function getQAChooserEmail(): Promise<string | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(COOKIE_NAME)?.value;
  if (!raw) return null;

  const result = verify(raw);
  if (!result) return null;

  if (result.expiresAt < Math.floor(Date.now() / 1000)) return null;

  return result.email;
}

/**
 * Invalidate the QA chooser cookie (called after a real borrower session
 * is created for the QA test deal).
 */
export async function clearQAChooserCookie(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    maxAge: 0,
    path: "/",
  });
}
