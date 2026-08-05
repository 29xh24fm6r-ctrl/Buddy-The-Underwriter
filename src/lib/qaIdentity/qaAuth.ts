import "server-only";

/**
 * QA borrower authentication — wraps the existing brokerage OTP
 * infrastructure with QA-specific logic.
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §1, §6 (remediated FINAL)
 *
 * Session lifecycle guarantee: exactly ONE canonical borrower session
 * token row is created or rotated per verification. No orphan tokens.
 * No raw token in JSON. No duplicate session rows.
 *
 * Production path: uses the same real OTP send/verify as a real borrower.
 * Staging path (deterministic): uses BORROWER_TEST_OTP when all safety
 * conditions are met.
 */

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
  | { ok: true; dealId: null; qaNeedsChooser: true }
  | {
      ok: false;
      error:
        | "not_qa_email"
        | "invalid_code"
        | "expired"
        | "too_many_attempts"
        | "not_found"
        | "qa_email_linked_to_non_test_deal"
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
 * Session guarantee: exactly one canonical session row per verification.
 * No raw token in JSON.
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

/**
 * PATH 1: Deterministic OTP verification (staging only).
 *
 * Session guarantee:
 *   - Existing lead: createBorrowerSession() exactly once
 *   - Existing test deal: createBorrowerSession() exactly once
 *   - New deal: createQATestApplication(RPC) + createBorrowerSession()
 *     → deal created by RPC, session created by canonical helper
 *     → ONE session row, no orphan
 */
async function verifyWithDeterministicOtp(args: {
  email: string;
  bankId: string;
}): Promise<QAVerifyCodeResult> {
  const sb = supabaseAdmin();
  const email = args.email.toLowerCase().trim();

  // Check for existing converted lead (non-test conversion)
  const { data: existingLead } = await sb
    .from("brokerage_leads")
    .select("converted_deal_id")
    .eq("bank_id", args.bankId)
    .eq("email", email)
    .not("converted_deal_id", "is", null)
    .maybeSingle();

  if (existingLead?.converted_deal_id) {
    const dealId = existingLead.converted_deal_id;

    // P0-2 (fail-closed): QA email linked to a non-test deal must be rejected
    const { data: leadDeal } = await sb
      .from("deals")
      .select("is_test")
      .eq("id", dealId)
      .maybeSingle();
    const ld = leadDeal as any;
    if (ld && !ld.is_test) {
      return { ok: false, error: "qa_email_linked_to_non_test_deal" };
    }

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

  // No existing deal — create new atomically via RPC
  // RPC creates deal only (no session). Session is created below.
  const newDeal = await createQATestApplication({
    bankId: args.bankId,
    email,
  });

  // Single canonical session creation
  await createBorrowerSession({
    dealId: newDeal.dealId,
    bankId: args.bankId,
    claimedEmail: email,
  });

  return { ok: true, dealId: newDeal.dealId, isNewDeal: true };
}

/**
 * PATH 2: Production real OTP verification.
 *
 * verifyCodeAndCreateSession() internally creates or reattaches the
 * canonical borrower session (see resolveOrCreateVerifiedBorrowerSession).
 * We do NOT call createBorrowerSession() again — that would create a
 * duplicate session row.
 */
async function verifyWithRealOtp(args: {
  email: string;
  code: string;
  bankId: string;
}): Promise<QAVerifyCodeResult> {
  const sb = supabaseAdmin();

  // P0-2 (fail-closed): Check whether this QA email is linked to any
  // non-test deal before running OTP verification.
  const { data: nonTestDeal } = await sb
    .from("deals")
    .select("id")
    .eq("bank_id", args.bankId)
    .eq("borrower_email", args.email.toLowerCase().trim())
    .neq("is_test", true)
    .limit(1)
    .maybeSingle();

  if (nonTestDeal) {
    return {
      ok: false,
      error: "qa_email_linked_to_non_test_deal",
    };
  }

  // verifyCodeAndCreateSession() already creates the canonical session.
  // Do NOT call createBorrowerSession() a second time.
  const result = await verifyCodeAndCreateSession({
    email: args.email,
    code: args.code,
    name: QA_BORROWER_NAME,
    bankId: args.bankId,
  });

  if (!result.ok) {
    return result;
  }

  // P0 SECURITY: QA identity verified but blocked from non-test deal.
  // Signal the caller to show QA chooser — no session token was created.
  if ("qaNeedsChooser" in result && result.qaNeedsChooser) {
    return { ok: true, dealId: null, qaNeedsChooser: true };
  }

  // P0-2 (fail-closed): After session is created/resolved, verify the deal
  // is not a pre-existing non-test deal.
  const { data: resolvedDeal } = await sb
    .from("deals")
    .select("is_test")
    .eq("id", result.dealId)
    .maybeSingle();
  const rd = resolvedDeal as any;
  if (rd && !rd.is_test) {
    return { ok: false, error: "qa_email_linked_to_non_test_deal" };
  }

  const dealId = result.dealId as string;
  const isNew = await markIfNewDeal(dealId);

  return { ok: true, dealId, isNewDeal: isNew };
}

/**
 * Marks a deal as test if not already. Returns true if newly marked.
 *
 * IDEMPOTENT (P0-5): test_run_id and test_created_at preserved on resume.
 *
 * P0-2 (fail-closed): Only deals that are (a) already is_test=true or
 * (b) created fresh by the QA RPC may become test applications.
 * A pre-existing non-test deal must not be reclassified.
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
    return false; // Already fully marked
  }

  // P0-2: If the deal is NOT already a test deal, reject
  if (deal && !deal.is_test) {
    throw new Error("qa_email_linked_to_non_test_deal");
  }

  // Deal is partially marked (is_test=true but no test_run_id) — complete it
  await markDealAsTestApplication(dealId);
  return true;
}
