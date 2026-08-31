import "server-only";

import { supabaseAdmin } from "@/lib/supabase/admin";
import { generateTestRunId } from "@/lib/qaIdentity/testRunId";
import { QA_BORROWER_NAME } from "@/lib/qaIdentity/config";

/**
 * Completes metadata for a deal already proven to be a QA test application.
 * This helper never reclassifies a non-test or unavailable deal.
 */
export async function markDealAsTestApplication(dealId: string): Promise<void> {
  const sb = supabaseAdmin();

  const { data: existing, error: readError } = await sb
    .from("deals")
    .select("id, is_test, test_run_id, test_suite, test_identity, test_created_at")
    .eq("id", dealId)
    .maybeSingle();

  if (readError) throw new Error("qa_state_unavailable");
  if (!existing) throw new Error("qa_deal_not_found");

  const deal = existing as any;
  if (deal.is_test !== true) throw new Error("not_a_test_application");
  if (deal.test_run_id && deal.test_created_at) return;

  const update: Record<string, unknown> = {
    test_suite: "borrower_e2e",
    test_identity: "borrower_qa",
    ...(!deal.test_run_id ? { test_run_id: generateTestRunId() } : {}),
    ...(!deal.test_created_at
      ? { test_created_at: new Date().toISOString() }
      : {}),
  };

  let updateQuery = sb
    .from("deals")
    .update(update)
    .eq("id", dealId)
    .eq("is_test", true);

  updateQuery = deal.test_run_id
    ? updateQuery.eq("test_run_id", deal.test_run_id)
    : updateQuery.is("test_run_id", null);

  const { data: updated, error: updateError } = await updateQuery
    .select("id, test_run_id, test_created_at")
    .maybeSingle();

  if (
    updateError ||
    !updated?.id ||
    !updated.test_run_id ||
    !updated.test_created_at
  ) {
    throw new Error("qa_mark_failed");
  }
}

/**
 * Creates a new QA test application atomically via the canonical RPC.
 */
export async function createQATestApplication(args: {
  bankId: string;
  email: string;
}): Promise<{ dealId: string; testRunId: string }> {
  const sb = supabaseAdmin();
  const testRunId = generateTestRunId();

  const { data, error } = await sb.rpc("create_qa_test_application", {
    p_bank_id: args.bankId,
    p_borrower_email: args.email.toLowerCase().trim(),
    p_borrower_name: QA_BORROWER_NAME,
    p_test_run_id: testRunId,
    p_test_suite: "borrower_e2e",
    p_test_identity: "borrower_qa",
  });

  if (error) throw new Error("qa_create_failed");

  const result = data as any;
  if (
    result?.ok !== true ||
    typeof result.deal_id !== "string" ||
    typeof result.test_run_id !== "string"
  ) {
    throw new Error("qa_create_failed");
  }

  return { dealId: result.deal_id, testRunId: result.test_run_id };
}

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

  if (error) throw new Error("qa_state_unavailable");
  return (data ?? []) as any[];
}
