import "server-only";

/**
 * QA borrower authentication — wraps the existing brokerage OTP
 * infrastructure with QA-specific logic.
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §1, §6
 *
 * Production path: uses the same real OTP send/verify as a real borrower.
 * Staging path (deterministic): uses BORROWER_TEST_OTP when all safety
 * conditions are met — NODE_ENV !== "production", BORROWER_TEST_AUTH_ENABLED=true,
 * email matches BORROWER_QA_EMAIL, BORROWER_TEST_OTP is present.
 */

import crypto from "node:crypto";
import {
  sendVerificationCode,
  verifyCodeAndCreateSession,
} from "@/lib/brokerage/emailVerification";
import {
  isQABorrowerEmail,
  validateDeterministicOtp,
  canUseDeterministicOtp,
  QA_BORROWER_NAME,
} from "@/lib/qaIdentity/config";
import { markDealAsTestApplication } from "@/lib/qaIdentity/markTestApplication";
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
 * Two paths:
 *   1. Deterministic OTP (staging only) — matches BORROWER_TEST_OTP directly.
 *      Creates a session without DB code verification.
 *   2. Real OTP (production) — uses the standard verifyCodeAndCreateSession.
 *
 * After successful verification, marks the deal as a test application.
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
  // Deterministic OTP: code is correct. Look for an existing session
  // for this email, or create a new one.

  const sb = supabaseAdmin();
  const email = args.email.toLowerCase().trim();

  // Check for an existing unconverted lead
  const { data: existingLead } = await sb
    .from("brokerage_leads")
    .select("converted_deal_id")
    .eq("bank_id", args.bankId)
    .eq("email", email)
    .not("converted_deal_id", "is", null)
    .maybeSingle();

  if (existingLead?.converted_deal_id) {
    // Reattach to existing deal
    const dealId = existingLead.converted_deal_id;
    await markIfNewDeal(dealId);
    return { ok: true, dealId, isNewDeal: false };
  }

  // Check for existing test deals for this email
  const { data: existingTestDeal } = await sb
    .from("deals")
    .select("id")
    .eq("bank_id", args.bankId)
    .eq("borrower_email", email)
    .eq("is_test", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingTestDeal) {
    await markIfNewDeal(existingTestDeal.id);
    return { ok: true, dealId: existingTestDeal.id, isNewDeal: false };
  }

  // No existing deal — create a new one
  return createDirectSession(args);
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
  return { ok: true, dealId: result.dealId, isNewDeal: isNew };
}

async function createDirectSession(args: {
  email: string;
  bankId: string;
}): Promise<QAVerifyCodeResult> {
  const sb = supabaseAdmin();
  const dealId = crypto.randomUUID();
  const rawToken = Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const hashBuf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(rawToken),
  );
  const tokenHash = Array.from(new Uint8Array(hashBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  const { error: dealErr } = await sb.from("deals").insert({
    id: dealId,
    bank_id: args.bankId,
    deal_type: "SBA",
    origin: "brokerage_anonymous",
    display_name: QA_BORROWER_NAME,
    borrower_name: QA_BORROWER_NAME,
    borrower_email: args.email.toLowerCase().trim(),
    status: "active",
    brokerage_session_token_hash: tokenHash,
    is_test: true,
    test_suite: "borrower_e2e",
    test_created_at: new Date().toISOString(),
    test_identity: "borrower_qa",
  });

  if (dealErr) {
    return { ok: false, error: `deal_creation_failed: ${dealErr.message}` };
  }

  await sb.from("borrower_session_tokens").insert({
    token_hash: tokenHash,
    deal_id: dealId,
    bank_id: args.bankId,
    claimed_email: args.email.toLowerCase().trim(),
    claimed_at: new Date().toISOString(),
    expires_at: new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  });

  // Mark with test_run_id
  await markDealAsTestApplication(dealId);

  return { ok: true, dealId, isNewDeal: true };
}

async function markIfNewDeal(dealId: string): Promise<boolean> {
  const sb = supabaseAdmin();

  const { data } = await sb
    .from("deals")
    .select("is_test")
    .eq("id", dealId)
    .maybeSingle();

  const deal = data as any;

  if (deal?.is_test === true) {
    return false;
  }

  await markDealAsTestApplication(dealId);
  return true;
}
