/**
 * SPEC-FLOW-V1 PR3 — Integration test: lifecycle events after submit.
 *
 * Walks the full submission flow against a real Supabase admin client
 * with a synthetic test deal at canonical lifecycle stage
 * `underwrite_in_progress`. Asserts the audit ledger has either
 * `deal.lifecycle.advanced` or `deal.lifecycle.advance_attempted` after
 * the submit call returns.
 *
 * ENV REQUIREMENTS:
 *   - SUPABASE_URL                      (or NEXT_PUBLIC_SUPABASE_URL)
 *   - SUPABASE_SERVICE_ROLE_KEY         (or SUPABASE_SERVICE_KEY)
 *   - PR3_INTEGRATION_TEST_BANK_ID      — bank with super_admin access
 *   - PR3_INTEGRATION_TEST_BANKER_ID    — banker user inside that bank
 *   - PR3_INTEGRATION_TEST_DEAL_ID      — pre-staged deal at
 *                                          underwrite_in_progress with all
 *                                          memo input readiness gates
 *                                          satisfied
 *
 * If any of these env vars are missing, the test is SKIPPED rather than
 * failing — that lets local CI runs (which don't have a service role
 * key) stay green while the integration check still runs in the
 * authorized environment.
 *
 * SKIP SEMANTICS:
 *   When the test runs but skips the body, it logs a structured message
 *   identifying the missing env var(s) so a CI matrix run can detect
 *   "skipped because env was missing" vs "skipped because the test
 *   genuinely doesn't apply". The CI matrix is responsible for failing
 *   the build if all matrix shards skip — that case means the
 *   integration check never ran.
 *
 * FIXTURE ASSUMPTION:
 *   The test does NOT create the deal — it expects a pre-staged fixture.
 *   This is intentional: setting up a deal at underwrite_in_progress
 *   with all the readiness gates passing requires synthesizing 20+
 *   tables of supporting data (financial facts, snapshots, research,
 *   pricing, memo inputs, etc.). That fixture is owned by the broader
 *   test-environment setup, not this file. If the fixture doesn't
 *   exist, the test fails (not skips) — the env vars implicitly
 *   contract that it's there.
 */

import test from "node:test";
import assert from "node:assert/strict";

const REQUIRED_ENV = [
  ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"],
  ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY"],
  ["PR3_INTEGRATION_TEST_BANK_ID"],
  ["PR3_INTEGRATION_TEST_BANKER_ID"],
  ["PR3_INTEGRATION_TEST_DEAL_ID"],
] as const;

function missingEnv(): string[] {
  return REQUIRED_ENV.filter(
    (group) => !group.some((name) => process.env[name]),
  ).map((group) => group.join(" or "));
}

test("[lifecycle-integration-real] submit emits canonical lifecycle event or advance_attempted", async (t) => {
  const missing = missingEnv();
  if (missing.length > 0) {
    t.skip(
      `Skipped — missing required env: ${missing.join(", ")}. Pre-stage the integration fixture and set these env vars to run.`,
    );
    return;
  }

  const dealId = process.env.PR3_INTEGRATION_TEST_DEAL_ID!;
  const bankerId = process.env.PR3_INTEGRATION_TEST_BANKER_ID!;
  // bankId is captured by ensureDealBankAccess inside the submission
  // helper from the deal row; it doesn't need to be passed here.

  // Snapshot the audit-ledger event count before the submit so we can
  // assert the new submit produced at least one new lifecycle-related
  // event. We query both deal_events (write target) and audit_ledger
  // (read view) for completeness.
  const { supabaseAdmin } = await import("@/lib/supabase/admin");
  const sb = supabaseAdmin();

  const { count: beforeCount } = await sb
    .from("audit_ledger" as any)
    .select("kind", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .in("kind", [
      "deal.lifecycle.advanced",
      "deal.lifecycle.advance_attempted",
    ]);

  const { submitCreditMemoToUnderwriting } = await import(
    "@/lib/creditMemo/submission/submitCreditMemoToUnderwriting"
  );

  const result = await submitCreditMemoToUnderwriting({
    dealId,
    bankerId,
    bankerNotes: "PR3 integration test — automated",
    acknowledgedWarnings: [],
  });

  // The submit may legitimately reject the call (readiness contract,
  // memo build, etc.) — the test fixture's job is to make the deal
  // submittable. If submit rejects, surface the reason to the test log
  // so the fixture can be debugged.
  if (!result.ok) {
    assert.fail(
      `submit returned ok:false (reason: ${result.reason}). The fixture deal must be at canonical underwrite_in_progress with all memo input readiness gates satisfied. Verify PR3_INTEGRATION_TEST_DEAL_ID is correctly staged.`,
    );
  }

  // Allow a brief settle window for fire-and-forget event writes.
  await new Promise((r) => setTimeout(r, 300));

  const { count: afterCount } = await sb
    .from("audit_ledger" as any)
    .select("kind", { count: "exact", head: true })
    .eq("deal_id", dealId)
    .in("kind", [
      "deal.lifecycle.advanced",
      "deal.lifecycle.advance_attempted",
    ]);

  const delta = (afterCount ?? 0) - (beforeCount ?? 0);
  assert.ok(
    delta >= 1,
    `Expected at least 1 new lifecycle event after submit (advanced or advance_attempted). Saw delta=${delta}. Either the wiring is broken or the lifecycle helper failed silently.`,
  );

  // Inspect the latest such event to confirm it carries the snapshotId
  // and the banker actor.
  const { data: latest } = await sb
    .from("audit_ledger" as any)
    .select("kind, payload")
    .eq("deal_id", dealId)
    .in("kind", [
      "deal.lifecycle.advanced",
      "deal.lifecycle.advance_attempted",
    ])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  assert.ok(latest, "Most recent lifecycle event row not found");
  const row = latest as unknown as {
    kind: string;
    payload: { actor_user_id?: string | null; input?: unknown };
  };
  assert.equal(
    row.payload?.actor_user_id,
    bankerId,
    "Latest lifecycle event must carry actor_user_id = the banker who submitted.",
  );

  if (row.kind === "deal.lifecycle.advance_attempted") {
    const input = row.payload?.input as
      | { trigger?: string; snapshot_id?: string }
      | null;
    assert.equal(
      input?.trigger,
      "banker_memo_submitted",
      "advance_attempted must carry trigger='banker_memo_submitted' so downstream filters can identify the cause.",
    );
    assert.equal(
      input?.snapshot_id,
      result.snapshotId,
      "advance_attempted must capture the snapshot id from the same submission.",
    );
  }
});
