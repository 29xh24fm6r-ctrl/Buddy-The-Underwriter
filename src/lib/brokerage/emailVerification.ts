import "server-only";

/**
 * Email-verification gate for the /start "workspace" entry flow.
 *
 * A borrower gives name + email before any chat happens; this module mints
 * a 6-digit code, emails it, and — once verified — resolves the borrower to
 * their session (creating a brand-new one on first verification, or
 * reattaching to their existing deal if this email has already converted a
 * lead before, e.g. verifying again from a different device). This is what
 * makes the workspace identity-keyed on a confirmed email rather than
 * whatever session cookie happens to already be sitting in a browser —
 * the root cause of a borrower briefly landing in someone else's stale
 * anonymous session (see the /start latency + wrong-franchise incident
 * this session's changes led up to).
 *
 * Code storage mirrors sessionToken.ts's posture: only the SHA-256 hash is
 * ever persisted, never the raw code.
 */

import { supabaseAdmin } from "@/lib/supabase/admin";
import { headers } from "next/headers";
import { getEmailProvider } from "@/lib/email/getProvider";
import { getOrCreateBorrowerSession } from "@/lib/brokerage/session";
import {
  getBorrowerSession,
  claimBorrowerSession,
  createBorrowerSession,
} from "@/lib/brokerage/sessionToken";
import { incrementAndCheck } from "@/lib/brokerage/rateLimits";
import {
  hashVerificationCode as hashCode,
  generateVerificationCode as generateCode,
} from "@/lib/brokerage/verificationCode";

const CODE_TTL_SECONDS = 10 * 60;
const MAX_VERIFY_ATTEMPTS = 5;

// Accepts "email@domain.tld" or "Name <email@domain.tld>" — the two shapes
// Resend's `from` field validation allows. A malformed EMAIL_FROM env var
// (e.g. missing a TLD, like "buddy@localhost") previously reached the
// provider as-is and hard-failed every OTP send in production with no
// actionable signal beyond a generic 500 — see incident 2026-07-20.
const FROM_ADDRESS_RE =
  /^(?:[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+|.+\s<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>)$/;
const DEFAULT_FROM_ADDRESS = "noreply@buddy.com";

export function resolveFromAddress(): string {
  const configured = process.env.EMAIL_FROM;
  if (configured && FROM_ADDRESS_RE.test(configured.trim())) {
    return configured.trim();
  }
  if (configured) {
    console.error(
      `[emailVerification] EMAIL_FROM is set but malformed ("${configured}") — ` +
        `falling back to ${DEFAULT_FROM_ADDRESS}. Fix the EMAIL_FROM env var.`,
    );
  }
  return DEFAULT_FROM_ADDRESS;
}

async function requestIp(): Promise<string> {
  const h = await headers();
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    h.get("x-real-ip") ??
    "unknown"
  );
}

export type SendCodeResult =
  | { ok: true }
  | { ok: false; error: "rate_limited"; retryAfterSeconds: number }
  | { ok: false; error: string };

export async function sendVerificationCode(args: {
  email: string;
  name?: string | null;
  bankId: string;
}): Promise<SendCodeResult> {
  const email = args.email.trim().toLowerCase();
  const ip = await requestIp();

  // Same durable, fail-open Postgres-backed counter checkConciergeRateLimit
  // already uses — 3 sends per email per 10 minutes, 10 per IP per hour.
  const emailWindow = await incrementAndCheck(
    `rl:otp-send:email:${email}`,
    600,
    3,
  );
  if (!emailWindow.allowed) {
    return {
      ok: false,
      error: "rate_limited",
      retryAfterSeconds: emailWindow.retryAfter,
    };
  }
  const ipWindow = await incrementAndCheck(`rl:otp-send:ip:${ip}`, 3600, 10);
  if (!ipWindow.allowed) {
    return {
      ok: false,
      error: "rate_limited",
      retryAfterSeconds: ipWindow.retryAfter,
    };
  }

  const code = generateCode();
  const codeHash = hashCode(code);
  const expiresAt = new Date(Date.now() + CODE_TTL_SECONDS * 1000).toISOString();

  const sb = supabaseAdmin();
  const { error } = await sb.from("borrower_email_verifications").insert({
    bank_id: args.bankId,
    email,
    name: args.name?.trim() || null,
    code_hash: codeHash,
    expires_at: expiresAt,
  });
  if (error) {
    console.error("[emailVerification] insert failed:", error.message);
    return { ok: false, error: "storage_failed" };
  }

  try {
    const provider = getEmailProvider();
    const from = resolveFromAddress();
    await provider.send({
      to: email,
      from,
      subject: "Your Buddy verification code",
      text: `Your verification code is ${code}. It expires in 10 minutes.\n\nIf you didn't request this, you can safely ignore this email.`,
    });
  } catch (e) {
    console.error(
      "[emailVerification] send failed:",
      e instanceof Error ? e.message : String(e),
    );
    return { ok: false, error: "email_send_failed" };
  }

  return { ok: true };
}

export type VerifyCodeResult =
  | { ok: true; dealId: string }
  | {
      ok: false;
      error: "invalid_code" | "expired" | "too_many_attempts" | "not_found";
    };

export async function verifyCodeAndCreateSession(args: {
  email: string;
  code: string;
  name?: string | null;
  bankId: string;
}): Promise<VerifyCodeResult> {
  const email = args.email.trim().toLowerCase();
  const sb = supabaseAdmin();

  const { data: row } = await sb
    .from("borrower_email_verifications")
    .select("id, code_hash, attempts, expires_at")
    .eq("bank_id", args.bankId)
    .eq("email", email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) return { ok: false, error: "not_found" };
  if (new Date(row.expires_at) < new Date()) return { ok: false, error: "expired" };
  if (row.attempts >= MAX_VERIFY_ATTEMPTS) {
    return { ok: false, error: "too_many_attempts" };
  }

  const providedHash = hashCode(args.code.trim());
  if (providedHash !== row.code_hash) {
    await sb
      .from("borrower_email_verifications")
      .update({ attempts: row.attempts + 1 })
      .eq("id", row.id);
    return { ok: false, error: "invalid_code" };
  }

  await sb
    .from("borrower_email_verifications")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id);

  const dealId = await resolveOrCreateVerifiedBorrowerSession({
    email,
    name: args.name ?? null,
    bankId: args.bankId,
  });
  return { ok: true, dealId };
}

/**
 * First verification ever for this email: create a fresh session + deal the
 * normal way, then claim it immediately (reuses claimBorrowerSession's
 * existing lead-capture side effect rather than duplicating it).
 *
 * Any later verification for the same email (a different device, or the
 * same device after clearing cookies) finds the lead already converted and
 * reattaches to that same deal_id instead of forking a second one — this is
 * the fix for the underlying stale/mismatched-session problem: identity is
 * keyed on the confirmed email, not on whichever cookie a browser happens
 * to still be holding.
 */
async function resolveOrCreateVerifiedBorrowerSession(args: {
  email: string;
  name: string | null;
  bankId: string;
}): Promise<string> {
  const sb = supabaseAdmin();

  const { data: existingLead } = await sb
    .from("brokerage_leads")
    .select("converted_deal_id")
    .eq("bank_id", args.bankId)
    .eq("email", args.email)
    .not("converted_deal_id", "is", null)
    .maybeSingle();

  if (existingLead?.converted_deal_id) {
    const current = await getBorrowerSession();
    if (current?.deal_id === existingLead.converted_deal_id) {
      // Already the right session on this device — nothing to mint.
      return existingLead.converted_deal_id;
    }
    await createBorrowerSession({
      dealId: existingLead.converted_deal_id,
      bankId: args.bankId,
      claimedEmail: args.email,
    });
    return existingLead.converted_deal_id;
  }

  const session = await getOrCreateBorrowerSession();
  await claimBorrowerSession({ tokenHash: session.tokenHash, email: args.email });
  return session.deal_id;
}
