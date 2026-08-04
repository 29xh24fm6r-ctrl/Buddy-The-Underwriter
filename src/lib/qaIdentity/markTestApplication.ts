import "server-only";

import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateTestRunId } from "@/lib/qaIdentity/testRunId";
import { QA_BORROWER_NAME } from "@/lib/qaIdentity/config";

/**
 * Marks a pre-existing deal as a QA test application.
 *
 * IDEMPOTENT (P0-5): assigns test_run_id and test_created_at only once.
 * If the deal already has test_run_id set, no update is performed.
 * Resume must preserve existing metadata.
 */
export async function markDealAsTestApplication(dealId: string): Promise<void> {
  const sb = supabaseAdmin();

  // Check if already marked (idempotent – P0-5)
  const { data: existing } = await sb
    .from("deals")
    .select("id, is_test, test_run_id, test_suite, test_identity, test_created_at")
    .eq("id", dealId)
    .maybeSingle();

  const d = existing as any;
  if (d?.is_test && d?.test_run_id) {
    // Already marked — no-op
    return;
  }

  const testRunId = generateTestRunId();

  // Only set test_run_id and test_created_at when they are null/absent
  const update: Record<string, any> = {
    is_test: true,
    test_suite: "borrower_e2e",
    test_identity: "borrower_qa",
  };

  // Set test_run_id only if not already present (P0-5)
  if (!d?.test_run_id) {
    update.test_run_id = testRunId;
  }

  // Set test_created_at only if not already present (P0-5)
  if (!d?.test_created_at) {
    update.test_created_at = new Date().toISOString();
  }

  const { error } = await sb
    .from("deals")
    .update(update)
    .eq("id", dealId);

  if (error) {
    console.error("[qaIdentity] Failed to mark deal as test:", error.message);
    throw new Error(`Failed to mark deal ${dealId} as test: ${error.message}`);
  }
}

/**
 * Creates a new QA test application atomically via the
 * `create_qa_test_application` RPC (P0-4).
 *
 * The RPC inserts deal + session token + test metadata in a single
 * transaction. On any failure, no partial record remains.
 */
export async function createQATestApplication(args: {
  bankId: string;
  email: string;
  tokenHash: string;
}): Promise<{ dealId: string; testRunId: string }> {
  const sb = supabaseAdmin();
  const testRunId = generateTestRunId();

  const { data, error } = await sb.rpc("create_qa_test_application", {
    p_bank_id: args.bankId,
    p_borrower_email: args.email.toLowerCase().trim(),
    p_borrower_name: QA_BORROWER_NAME,
    p_token_hash: args.tokenHash,
    p_test_run_id: testRunId,
    p_test_suite: "borrower_e2e",
    p_test_identity: "borrower_qa",
  });

  if (error) {
    throw new Error(`create_qa_test_application RPC failed: ${error.message}`);
  }

  const result = data as any;
  if (!result?.ok) {
    throw new Error(
      `create_qa_test_application RPC failed: ${result?.error ?? "unknown error"}`,
    );
  }

  return { dealId: result.deal_id, testRunId: result.test_run_id };
}

/**
 * Lists QA test applications for a given email.
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
