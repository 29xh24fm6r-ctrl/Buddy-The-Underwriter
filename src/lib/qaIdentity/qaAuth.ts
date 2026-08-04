import "server-only";

/**
 * QA borrower authentication — wraps the existing brokerage OTP
 * infrastructure with QA-specific logic.
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §1, §6 (remediated)
 *
 * P0-2: Never returns raw session tokens. Uses canonical
 *       `createBorrowerSession` from sessionToken.ts which sets
 *       the raw token only as an HttpOnly cookie.
 *
 * Production path: uses the same real OTP send/verify as a real borrower.
 * Staging path (deterministic): uses BORROWER_TEST_OTP when all safety
 * conditions are met.
 */

import crypto from "node:crypto";
import {
  sendVerificationCode,
  verifyCodeAndCreateSession,
} from "@/lib/brokerage/emailVerification";
import { createBorrowerSession } from "@/lib/brokerage/sessionToken";
import {
  isQABorrowerEmail,
  validateDeterministicOtp,
  canUseDeterministicOtp,
  QA_BORROWER_NAME,
} from "@/lib/qaIdentity/config";
import { markDealAsTestApplication, createQATestApplication } from "@/lib/qaIdentity/markTestApplication";
import { supabaseAdmin } from "@/lib/supabase/admin";

export type QASendCodeResult =
  | { ok: true; deterministic: boolean }
  | {
      ok: false;
      error: "not_qa_email" | "rate_limited" | string;
      retryAfterSeconds?: number;
    };

export type QAVerifyCodeResult =
  | { ok: true; dealId: string; isNewDeal: boolean }
  | {
      ok: false;
      error:
        | "not_qa_email"
        | "invalid_code"
        | "expired"
        | "too_many_attempts"
        | "not_found"
        | string;
    };

/**
 * Send a verification code to the QA borrower.
 */
export async function sendQAVerificationCode(args: {
  email: string;
  bankId: string;
}): Promise<QASendCodeResult> {
  if (!isQABorrowerEmail(args.email)) {
    return { ok: false, error: "not_qa_email" };
  }

  if (canUseDeterministicOtp()) {
    return { ok: true, deterministic: true };
  }

  const result = await sendVerificationCode({
    email: args.email,
    name: QA_BORROWER_NAME,
    bankId: args.bankId,
  });

  if (!result.ok) {
    return result;
  }

  return { ok: true, deterministic: false };
}

/**
 * Verify a code for the QA borrower.
 *
 * P0-2: Session cookie is set via createBorrowerSession (HttpOnly).
 *       No raw token is ever returned in the JSON response.
 */
export async function verifyQACode(args: {
  email: string;
  code: string;
  bankId: string;
}): Promise<QAVerifyCodeResult> {
  if (!isQABorrowerEmail(args.email)) {
    return { ok: false, error: "not_qa_email" };
  }

  if (validateDeterministicOtp(args.code)) {
    return verifyWithDeterministicOtp(args);
  }

  return verifyWithRealOtp(args);
}

async function verifyWithDeterministicOtp(args: {
  email: string;
  bankId: string;
}): Promise<QAVerifyCodeResult> {
  const sb = supabaseAdmin();
  const email = args.email.toLowerCase().trim();

  // Check for an existing converted lead
  const { data: existingLead } = await sb
    .from("brokerage_leads")
    .select("converted_deal_id")
    .eq("bank_id", args.bankId)
    .eq("email", email)
    .not("converted_deal_id", "is", null)
    .maybeSingle();

  if (existingLead?.converted_deal_id) {
    const dealId = existingLead.converted_deal_id;
    await markIfNewDeal(dealId);
    await createBorrowerSession({ dealId, bankId: args.bankId, claimedEmail: email });
    return { ok: true, dealId, isNewDeal: false };
  }

  // Check for existing test deals
  const { data: existingTestDeal } = await sb
    .from("deals")
    .select("id, bank_id")
    .eq("bank_id", args.bankId)
    .eq("borrower_email", email)
    .eq("is_test", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingTestDeal) {
    await markIfNewDeal(existingTestDeal.id);
    await createBorrowerSession({
      dealId: existingTestDeal.id,
      bankId: existingTestDeal.bank_id ?? args.bankId,
      claimedEmail: email,
    });
    return { ok: true, dealId: existingTestDeal.id, isNewDeal: false };
  }

  // No existing deal — create a new one atomically
  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
  const newDeal = await createQATestApplication({
    bankId: args.bankId,
    email,
    tokenHash,
  });

  // Set the cookie via canonical helper (HttpOnly, Secure, SameSite)
  await createBorrowerSession({
    dealId: newDeal.dealId,
    bankId: args.bankId,
    claimedEmail: email,
  });

  return { ok: true, dealId: newDeal.dealId, isNewDeal: true };
}

async function verifyWithRealOtp(args: {
  email: string;
  code: string;
  bankId: string;
}): Promise<QAVerifyCodeResult> {
  const result = await verifyCodeAndCreateSession({
    email: args.email,
    code: args.code,
    name: QA_BORROWER_NAME,
    bankId: args.bankId,
  });

  if (!result.ok) {
    return result;
  }

  const isNew = await markIfNewDeal(result.dealId);

  // Ensure session cookie is set via canonical helper
  await createBorrowerSession({
    dealId: result.dealId,
    bankId: args.bankId,
    claimedEmail: args.email.toLowerCase().trim(),
  });

  return { ok: true, dealId: result.dealId, isNewDeal: isNew };
}

/**
 * Marks a deal as test if not already. Returns true if newly marked.
 * IDEMPOTENT (P0-5): test_run_id and test_created_at preserved on resume.
 */
async function markIfNewDeal(dealId: string): Promise<boolean> {
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("deals")
    .select("is_test, test_run_id")
    .eq("id", dealId)
    .maybeSingle();

  const deal = data as any;

  if (deal?.is_test === true && deal?.test_run_id) {
    return false; // Already fully marked — idempotent (P0-5)
  }

  await markDealAsTestApplication(dealId);
  return true;
}
