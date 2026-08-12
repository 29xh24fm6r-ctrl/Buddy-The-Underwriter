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
 *
 * P0 SECURITY (2026-08-05): QA identities must never resolve to a non-test
 * production deal. When a configured QA email verifies, the lead lookup
 * may return a converted_deal_id that points to a non-test deal — this
 * path now checks is_test before creating any session token.
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
import { isQABorrowerEmail } from "@/lib/qaIdentity/config";
import { setQAChooserCookie } from "@/lib/brokerage/qaChooser";
import { setApplicationChooserCookie } from "@/lib/brokerage/applicationChooser";
import { listBorrowerApplications } from "@/lib/brokerage/listBorrowerApplications";

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
  | { ok: true; dealId: null; qaNeedsChooser: true }
  | { ok: true; dealId: null; applicationChoiceNeeded: true }
  | { ok: true; dealId: null; noApplicationsFound: true }
  | {
      ok: false;
      error: "invalid_code" | "expired" | "too_many_attempts" | "not_found" | "qa_blocked_non_test_deal";
    };

export async function verifyCodeAndCreateSession(args: {
  email: string;
  code: string;
  name?: string | null;
  bankId: string;
  mode?: "start" | "welcome-back";
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

  const resolution = await resolveOrCreateVerifiedBorrowerSession({
    email,
    name: args.name ?? null,
    bankId: args.bankId,
    mode: args.mode,
  });

  // P0 SECURITY: QA identity must never return a non-test dealId.
  // If the session was resolved to a non-test deal, signal the client to
  // show the QA chooser instead — no session token was created.
  if (resolution.kind === "qa_needs_chooser") {
    // P1 FIX (2026-08-05): Set a signed QA identity cookie so the
    // applications endpoint can authenticate the QA borrower for
    // listing/creating test applications without a deal-bound session.
    // This breaks the circular dependency: "need a session to list apps,
    // but need to create an app to get a session."
    await setQAChooserCookie(email);
    return { ok: true, dealId: null, qaNeedsChooser: true };
  }

  // General (non-QA) case: one or more prior applications exist for this
  // verified email — do not silently resume. Set the application-chooser
  // cookie (proves this email+bank were just verified) and signal the
  // client to show the Welcome Back chooser instead of a deal-bound
  // session. No session token is created until the borrower explicitly
  // chooses resume/view/new.
  if (resolution.kind === "application_choice_needed") {
    await setApplicationChooserCookie(email, args.bankId);
    return { ok: true, dealId: null, applicationChoiceNeeded: true };
  }

  // SPEC-WELCOME-BACK-ZERO-APP-SESSION-1 — zero applications is NOT an
  // error and must not force a second verification. Set the exact same
  // application-chooser identity cookie the application_choice_needed
  // branch above already sets, proving this browser just verified this
  // email for this bank — so the borrower's subsequent explicit "Start a
  // new application" click (POST action:"new" to
  // /api/brokerage/session/applications) can create a real session without
  // any new OTP. No new cookie/auth mechanism introduced; this reuses
  // applicationChooser.ts's existing, already-tested identity proof.
  if (resolution.kind === "no_applications") {
    await setApplicationChooserCookie(email, args.bankId);
    return { ok: true, dealId: null, noApplicationsFound: true };
  }

  return { ok: true, dealId: resolution.dealId };
}

/**
 * P0 SECURITY — QA guard exception class.
 * Thrown internally when a QA identity would be bound to a non-test deal.
 * Caught immediately in the calling scope — never escapes to the HTTP layer.
 */
class QANonTestDealGuard extends Error {
  constructor(email: string, dealId: string) {
    super(`QA identity ${email} blocked from non-test deal ${dealId}`);
    this.name = "QANonTestDealGuard";
  }
}

/**
 * First verification ever for this email: create a fresh session + deal the
 * normal way, then claim it immediately (reuses claimBorrowerSession's
 * existing lead-capture side effect rather than duplicating it).
 *
 * Any later verification for the same email where prior applications exist
 * no longer auto-resumes — it signals the caller to show the Welcome Back
 * chooser instead, so the borrower explicitly picks resume/view/new rather
 * than being silently reattached (this was the fix approved after the
 * incognito-reproducible "existing owner names" investigation: identity is
 * still keyed on the confirmed email, but resuming is now an explicit
 * borrower choice, not an automatic one).
 *
 * QA identity handling is completely unchanged from before this change —
 * same brokerage_leads lookup, same is_test guard, same session-reuse
 * optimization — the new chooser only applies to the general (non-QA) path.
 *
 * Returns a discriminated result: a resolved deal, "qa needs chooser"
 * (QA-only, existing behavior), or "application choice needed" (new,
 * general case — one or more prior applications exist for this email).
 */
async function resolveOrCreateVerifiedBorrowerSession(args: {
  email: string;
  name: string | null;
  bankId: string;
  mode?: "start" | "welcome-back";
}): Promise<
  | { kind: "deal"; dealId: string }
  | { kind: "qa_needs_chooser" }
  | { kind: "application_choice_needed" }
  | { kind: "no_applications" }
> {
  const sb = supabaseAdmin();
  const isQA = isQABorrowerEmail(args.email);

  if (isQA) {
    // QA path: unchanged from before this change.
    const { data: existingLead } = await sb
      .from("brokerage_leads")
      .select("converted_deal_id")
      .eq("bank_id", args.bankId)
      .eq("email", args.email)
      .not("converted_deal_id", "is", null)
      .maybeSingle();

    if (existingLead?.converted_deal_id) {
      // P0 SECURITY: QA identity must never be bound to a non-test deal.
      // Verify is_test before creating any session token.
      const { data: deal } = await sb
        .from("deals")
        .select("is_test")
        .eq("id", existingLead.converted_deal_id)
        .maybeSingle();

      const isTest = (deal as any)?.is_test === true;

      if (!isTest) {
        // Security event — log without exposing tokens
        console.error(
          `[emailVerification] P0 SECURITY: QA identity ${args.email} blocked from ` +
          `non-test deal ${existingLead.converted_deal_id}. No session token created.`,
        );
        return { kind: "qa_needs_chooser" };
      }

      const current = await getBorrowerSession();
      if (current?.deal_id === existingLead.converted_deal_id) {
        // Already the right session on this device — nothing to mint.
        return { kind: "deal", dealId: existingLead.converted_deal_id };
      }
      await createBorrowerSession({
        dealId: existingLead.converted_deal_id,
        bankId: args.bankId,
        claimedEmail: args.email,
      });
      return { kind: "deal", dealId: existingLead.converted_deal_id };
    }

    const qaSession = await getOrCreateBorrowerSession();
    await claimBorrowerSession({ tokenHash: qaSession.tokenHash, email: args.email });
    return { kind: "deal", dealId: qaSession.deal_id };
  }

  // General (non-QA) path: check for ANY existing applications for this
  // email at this bank before ever creating/resuming a session.
  const existingApplications = await listBorrowerApplications({
    email: args.email,
    bankId: args.bankId,
  });

  if (existingApplications.length > 0) {
    return { kind: "application_choice_needed" };
  }

  if (args.mode === "welcome-back") {
    return { kind: "no_applications" };
  }

  const session = await getOrCreateBorrowerSession();
  await claimBorrowerSession({ tokenHash: session.tokenHash, email: args.email });
  return { kind: "deal", dealId: session.deal_id };
}
