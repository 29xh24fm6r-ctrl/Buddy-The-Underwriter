/**
 * Unit tests for markTestApplication.ts.
 *
 * P0-5: Idempotent marking — test_run_id and test_created_at must be
 * assigned only once. Resume must preserve existing metadata.
 *
 * P0-4: Atomic creation via RPC.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert";
import crypto from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/admin";
import * as testlib from "@/lib/qaIdentity/__tests__/testHelpers";

const TEST_BANK_ID = "00000000-0000-0000-0000-00000000qq99";

describe("markDealAsTestApplication — idempotent (P0-5)", () => {
  let sb: ReturnType<typeof supabaseAdmin>;

  before(() => {
    sb = supabaseAdmin();
  });

  it("sets test metadata on a fresh deal", async () => {
    const dealId = crypto.randomUUID();

    // Create a minimal deal
    await sb.from("deals").insert({
      id: dealId,
      bank_id: TEST_BANK_ID,
      deal_type: "SBA",
      display_name: "Test Fresh Deal",
      borrower_name: "Test Fresh",
      borrower_email: "fresh@test.com",
      status: "active",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const { markDealAsTestApplication } = await import(
      "@/lib/qaIdentity/markTestApplication"
    );
    await markDealAsTestApplication(dealId);

    // Verify
    const { data } = await sb
      .from("deals")
      .select("is_test, test_suite, test_run_id, test_created_at, test_identity")
      .eq("id", dealId)
      .maybeSingle();

    const d = data as any;
    assert.equal(d.is_test, true);
    assert.equal(d.test_suite, "borrower_e2e");
    assert.equal(d.test_identity, "borrower_qa");
    assert.ok(d.test_run_id, "test_run_id should be set");
    assert.ok(d.test_run_id.startsWith("E2E-"), "test_run_id should have E2E prefix");
    assert.ok(d.test_created_at, "test_created_at should be set");
  });

  it("preserves existing test_run_id on second call (idempotent — P0-5)", async () => {
    const dealId = crypto.randomUUID();

    await sb.from("deals").insert({
      id: dealId,
      bank_id: TEST_BANK_ID,
      deal_type: "SBA",
      display_name: "Test Idempotent",
      borrower_name: "Test Idempotent",
      borrower_email: "idempotent@test.com",
      status: "active",
      is_test: true,
      test_suite: "borrower_e2e",
      test_run_id: "E2E-ORIGINAL-FIXED-VALUE",
      test_created_at: "2024-01-01T00:00:00.000Z",
      test_identity: "borrower_qa",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const { markDealAsTestApplication } = await import(
      "@/lib/qaIdentity/markTestApplication"
    );
    await markDealAsTestApplication(dealId);

    // Verify NOTHING changed
    const { data } = await sb
      .from("deals")
      .select("test_run_id, test_created_at, test_suite, test_identity")
      .eq("id", dealId)
      .maybeSingle();

    const d = data as any;
    assert.equal(d.test_run_id, "E2E-ORIGINAL-FIXED-VALUE");
    assert.equal(d.test_created_at, "2024-01-01T00:00:00.000Z");
    assert.equal(d.test_suite, "borrower_e2e");
    assert.equal(d.test_identity, "borrower_qa");
  });

  it("preserves metadata when is_test is true but test_run_id is missing (partial fix)", async () => {
    const dealId = crypto.randomUUID();

    await sb.from("deals").insert({
      id: dealId,
      bank_id: TEST_BANK_ID,
      deal_type: "SBA",
      display_name: "Partial Test Deal",
      borrower_name: "Partial Test",
      borrower_email: "partial@test.com",
      status: "active",
      is_test: true,
      test_suite: "borrower_e2e",
      test_identity: "borrower_qa",
      // test_run_id and test_created_at are missing
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const { markDealAsTestApplication } = await import(
      "@/lib/qaIdentity/markTestApplication"
    );
    await markDealAsTestApplication(dealId);

    const { data } = await sb
      .from("deals")
      .select("test_run_id, test_created_at, test_suite, test_identity, is_test")
      .eq("id", dealId)
      .maybeSingle();

    const d = data as any;
    // test_run_id should now be set
    assert.ok(d.test_run_id, "test_run_id should be filled in");
    assert.ok(d.test_created_at, "test_created_at should be filled in");
    assert.equal(d.test_suite, "borrower_e2e", "test_suite must be preserved");
    assert.equal(d.test_identity, "borrower_qa", "test_identity must be preserved");
  });
});

describe("createQATestApplication — atomic via RPC (P0-4)", () => {
  let sb: ReturnType<typeof supabaseAdmin>;

  before(() => {
    sb = supabaseAdmin();
  });

  it("creates deal + session + test metadata atomically", async () => {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    const { createQATestApplication } = await import(
      "@/lib/qaIdentity/markTestApplication"
    );
    const result = await createQATestApplication({
      bankId: TEST_BANK_ID,
      email: "atomic-test@buddy-test.com",
      tokenHash,
    });

    assert.ok(result.dealId, "dealId must be returned");
    assert.ok(result.testRunId, "testRunId must be returned");

    // Verify deal exists with all test metadata
    const { data: deal } = await sb
      .from("deals")
      .select("is_test, test_suite, test_run_id, test_created_at, test_identity")
      .eq("id", result.dealId)
      .maybeSingle();

    const d = deal as any;
    assert.equal(d.is_test, true);
    assert.equal(d.test_suite, "borrower_e2e");
    assert.equal(d.test_identity, "borrower_qa");
    assert.equal(d.test_run_id, result.testRunId);
    assert.ok(d.test_created_at);

    // Verify session token exists
    const { data: token } = await sb
      .from("borrower_session_tokens")
      .select("token_hash, deal_id")
      .eq("token_hash", tokenHash)
      .eq("deal_id", result.dealId)
      .maybeSingle();

    assert.ok(token, "Session token must exist");
    assert.equal(token.deal_id, result.dealId);
  });
});
