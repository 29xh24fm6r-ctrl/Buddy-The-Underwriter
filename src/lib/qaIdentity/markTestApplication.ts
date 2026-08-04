import "server-only";

import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateTestRunId } from "@/lib/qaIdentity/testRunId";
import { QA_BORROWER_NAME } from "@/lib/qaIdentity/config";

/**
 * Marks a deal as a QA test application.
 *
 * Sets:
 *   is_test = true
 *   test_suite = "borrower_e2e"
 *   test_run_id = E2E-YYYYMMDD-HHMMSS-<random>
 *   test_created_at = now
 *   test_identity = "borrower_qa"
 *   display_name = "Buddy QA Borrower" (if not already set)
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §2
 */
export async function markDealAsTestApplication(dealId: string): Promise<void> {
  const sb = supabaseAdmin();
  const testRunId = generateTestRunId();

  const { error } = await sb
    .from("deals")
    .update({
      is_test: true,
      test_suite: "borrower_e2e",
      test_run_id: testRunId,
      test_created_at: new Date().toISOString(),
      test_identity: "borrower_qa",
    })
    .eq("id", dealId);

  if (error) {
    console.error("[qaIdentity] Failed to mark deal as test:", error.message);
    throw new Error(`Failed to mark deal ${dealId} as test: ${error.message}`);
  }
}

/**
 * Creates a new QA test application deal.
 *
 * Returns the new deal ID.
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §5
 */
export async function createQATestApplication(args: {
  bankId: string;
  email: string;
  tokenHash: string;
}): Promise<string> {
  const sb = supabaseAdmin();
  const dealId = crypto.randomUUID();
  const testRunId = generateTestRunId();

  const { error } = await sb.from("deals").insert({
    id: dealId,
    bank_id: args.bankId,
    deal_type: "SBA",
    origin: "brokerage_anonymous",
    display_name: QA_BORROWER_NAME,
    borrower_name: QA_BORROWER_NAME,
    borrower_email: args.email,
    status: "active",
    brokerage_session_token_hash: args.tokenHash,
    is_test: true,
    test_suite: "borrower_e2e",
    test_run_id: testRunId,
    test_created_at: new Date().toISOString(),
    test_identity: "borrower_qa",
  });

  if (error) {
    throw new Error(`Failed to create QA test deal: ${error.message}`);
  }

  const { error: tokenErr } = await sb.from("borrower_session_tokens").insert({
    token_hash: args.tokenHash,
    deal_id: dealId,
    bank_id: args.bankId,
    claimed_email: args.email,
    claimed_at: new Date().toISOString(),
    expires_at: new Date(
      Date.now() + 90 * 24 * 60 * 60 * 1000,
    ).toISOString(),
  });

  if (tokenErr) {
    console.error(
      "[qaIdentity] Failed to create session token for test deal:",
      tokenErr.message,
    );
    throw new Error(`Failed to create session token: ${tokenErr.message}`);
  }

  return dealId;
}

/**
 * Lists QA test applications for a given email.
 *
 * Returns deals ordered by test_created_at descending.
 */
export async function listQATestApplications(args: {
  email: string;
  bankId: string;
}): Promise<
  Array<{
    id: string;
    test_run_id: string;
    test_created_at: string;
    display_name: string;
    stage: string;
    status: string;
  }>
> {
  const sb = supabaseAdmin();

  const { data, error } = await sb
    .from("deals")
    .select("id, test_run_id, test_created_at, display_name, stage, status")
    .eq("bank_id", args.bankId)
    .eq("borrower_email", args.email.toLowerCase().trim())
    .eq("is_test", true)
    .eq("test_identity", "borrower_qa")
    .order("test_created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("[qaIdentity] Failed to list QA test applications:", error.message);
    return [];
  }

  return (data ?? []) as any[];
}
