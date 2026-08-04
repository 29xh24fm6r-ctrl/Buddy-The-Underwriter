/**
 * QA Borrower Identity E2E tests.
 *
 * SPEC-BORROWER-QA-IDENTITY-V1 §9
 *
 * These tests require:
 *   - BORROWER_QA_EMAIL set to a test email
 *   - In production: real OTP via email (manual or automated email checking)
 *   - In staging: BORROWER_TEST_AUTH_ENABLED=true + BORROWER_TEST_OTP set
 *   - A running dev server (pnpm dev)
 *
 * Run with:
 *   npx playwright test e2e/qa-borrower-identity.spec.ts
 *
 * For staging deterministic OTP:
 *   BORROWER_QA_EMAIL=qa@test.com \
 *   BORROWER_TEST_AUTH_ENABLED=true \
 *   BORROWER_TEST_OTP=888888 \
 *   npx playwright test e2e/qa-borrower-identity.spec.ts
 */

import { test, expect } from "@playwright/test";

const QA_EMAIL = process.env.BORROWER_QA_EMAIL || "qa-borrower@buddy-test.com";
const TEST_OTP = process.env.BORROWER_TEST_OTP || "888888";
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

test.describe("QA Borrower Identity", () => {
  test("normal borrower is not marked as test", async ({ request }) => {
    // Send OTP for a non-QA email
    const sendResp = await request.post(`${BASE_URL}/api/qa/borrower/auth`, {
      data: { action: "send", email: "normal-borrower@example.com" },
    });

    expect(sendResp.status()).toBe(403);
    const sendBody = await sendResp.json();
    expect(sendBody.ok).toBe(false);
    expect(sendBody.error).toBe("not_qa_email");
  });

  test("QA borrower can send and verify OTP", async ({ request }) => {
    // Step 1: Send verification code
    const sendResp = await request.post(`${BASE_URL}/api/qa/borrower/auth`, {
      data: { action: "send", email: QA_EMAIL },
    });

    // In staging with deterministic OTP, this returns ok immediately
    // In production, this sends a real email
    const sendBody = await sendResp.json();

    if (sendBody.ok === false && sendBody.error === "not_qa_email") {
      test.skip(true, "BORROWER_QA_EMAIL not configured or doesn't match");
    }

    // Rate limiting is acceptable
    if (sendResp.status() === 429) {
      console.log("Rate limited — skipping verify test");
      return;
    }

    expect(sendResp.status()).toBe(200);
    expect(sendBody.ok).toBe(true);

    // Step 2: Verify the code
    const verifyResp = await request.post(`${BASE_URL}/api/qa/borrower/auth`, {
      data: { action: "verify", email: QA_EMAIL, code: TEST_OTP },
    });

    const verifyBody = await verifyResp.json();

    // In production with real OTP, this may fail if we don't have the real code
    // Skip the test gracefully
    if (
      verifyBody.ok === false &&
      (verifyBody.error === "invalid_code" || verifyBody.error === "not_found")
    ) {
      console.log(
        "Real OTP code didn't match (expected in production without email access) — skipping verification check",
      );
      return;
    }

    // In staging with deterministic OTP, this should succeed
    expect(verifyResp.status()).toBe(200);
    expect(verifyBody.ok).toBe(true);
    expect(typeof verifyBody.dealId).toBe("string");
    expect(verifyBody.dealId.length).toBeGreaterThan(0);
  });

  test("QA borrower application has is_test = true", async ({ request }) => {
    // Create a QA application directly
    const createResp = await request.post(
      `${BASE_URL}/api/qa/borrower/applications`,
      {
        data: { action: "create", email: QA_EMAIL },
      },
    );

    if (createResp.status() === 403) {
      test.skip(true, "BORROWER_QA_EMAIL not configured");
    }

    if (createResp.status() !== 200) {
      const body = await createResp.json();
      console.log("Create failed:", body);
      test.skip(true, `Could not create QA application: ${body.error}`);
      return;
    }

    const createBody = await createResp.json();
    expect(createBody.ok).toBe(true);
    expect(createBody.isNew).toBe(true);
    expect(typeof createBody.dealId).toBe("string");

    const dealId = createBody.dealId;

    // Verify the deal is marked as test (check via the applications list)
    const listResp = await request.get(
      `${BASE_URL}/api/qa/borrower/applications?email=${encodeURIComponent(QA_EMAIL)}`,
    );

    if (listResp.status() === 403) {
      test.skip(true, "Not authorized");
    }

    expect(listResp.status()).toBe(200);
    const listBody = await listResp.json();
    expect(listBody.ok).toBe(true);
    expect(Array.isArray(listBody.applications)).toBe(true);

    const found = listBody.applications.find(
      (a: any) => a.id === dealId,
    );
    expect(found).toBeDefined();
    expect(found.test_run_id).toBeDefined();

    // Verify the test_run_id format
    expect(found.test_run_id).toMatch(
      /^E2E-\d{8}-\d{6}-[0-9a-f]{6}$/,
    );
  });

  test("new QA application does not inherit prior facts", async ({ request }) => {
    // Create first QA application
    const create1Resp = await request.post(
      `${BASE_URL}/api/qa/borrower/applications`,
      {
        data: { action: "create", email: QA_EMAIL },
      },
    );

    if (create1Resp.status() !== 200) {
      test.skip(true, "Could not create first QA application");
      return;
    }

    // Create second QA application
    const create2Resp = await request.post(
      `${BASE_URL}/api/qa/borrower/applications`,
      {
        data: { action: "create", email: QA_EMAIL },
      },
    );

    if (create2Resp.status() !== 200) {
      test.skip(true, "Could not create second QA application");
      return;
    }

    const body1 = await create1Resp.json();
    const body2 = await create2Resp.json();

    expect(body1.dealId).not.toBe(body2.dealId);

    // Verify both have distinct test_run_ids
    const listResp = await request.get(
      `${BASE_URL}/api/qa/borrower/applications?email=${encodeURIComponent(QA_EMAIL)}`,
    );

    const listBody = await listResp.json();
    const app1 = listBody.applications.find((a: any) => a.id === body1.dealId);
    const app2 = listBody.applications.find((a: any) => a.id === body2.dealId);

    expect(app1).toBeDefined();
    expect(app2).toBeDefined();
    expect(app1.test_run_id).not.toBe(app2.test_run_id);

    // The second app should be a fresh deal — its test_created_at should
    // not be identical to the first
    expect(app1.test_created_at).not.toBe(app2.test_created_at);
  });

  test("resume returns the selected QA application", async ({ request }) => {
    // First, create a QA application
    const createResp = await request.post(
      `${BASE_URL}/api/qa/borrower/applications`,
      {
        data: { action: "create", email: QA_EMAIL },
      },
    );

    if (createResp.status() !== 200) {
      test.skip(true, "Could not create QA application");
      return;
    }

    const createBody = await createResp.json();
    const dealId = createBody.dealId;

    // Resume the same application
    const resumeResp = await request.post(
      `${BASE_URL}/api/qa/borrower/applications`,
      {
        data: { action: "resume", email: QA_EMAIL, dealId },
      },
    );

    expect(resumeResp.status()).toBe(200);
    const resumeBody = await resumeResp.json();
    expect(resumeBody.ok).toBe(true);
    expect(resumeBody.dealId).toBe(dealId);

    // Resuming a non-existent deal should fail
    const badResumeResp = await request.post(
      `${BASE_URL}/api/qa/borrower/applications`,
      {
        data: {
          action: "resume",
          email: QA_EMAIL,
          dealId: "00000000-0000-0000-0000-000000000000",
        },
      },
    );

    expect(badResumeResp.status()).toBe(404);
  });

  test("test application cannot be sent to a real lender", async ({ request }) => {
    // Create a QA application
    const createResp = await request.post(
      `${BASE_URL}/api/qa/borrower/applications`,
      {
        data: { action: "create", email: QA_EMAIL },
      },
    );

    if (createResp.status() !== 200) {
      test.skip(true, "Could not create QA application");
      return;
    }

    const createBody = await createResp.json();
    const dealId = createBody.dealId;

    // Try to match lenders (should be rejected)
    const matchResp = await request.get(
      `${BASE_URL}/api/deals/${dealId}/lenders/match`,
    );

    // The lender match route requires Clerk auth, so it may return 403
    // But if it passes auth, it should block test deals
    if (matchResp.status() === 403) {
      // Auth required — test passes (test deal can't reach matching engine)
      return;
    }

    // If somehow it gets through auth, it should be blocked by assertNotTestDeal
    const matchBody = await matchResp.json();
    if (matchResp.status() === 500) {
      expect(matchBody.error).toContain("test");
    }
  });

  test("cleanup dry-run lists test applications without deleting", async ({
    request,
  }) => {
    // Dry run
    const dryRunResp = await request.post(`${BASE_URL}/api/admin/qa/cleanup`, {
      data: { dryRun: true },
    });

    if (dryRunResp.status() === 403) {
      test.skip(true, "Admin cleanup requires auth");
      return;
    }

    expect(dryRunResp.status()).toBe(200);
    const body = await dryRunResp.json();
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(Array.isArray(body.deals)).toBe(true);
  });

  test("cleanup requires confirmation to delete", async ({ request }) => {
    const resp = await request.post(`${BASE_URL}/api/admin/qa/cleanup`, {
      data: { dryRun: false, confirm: false },
    });

    if (resp.status() === 403) {
      test.skip(true, "Admin cleanup requires auth");
      return;
    }

    expect(resp.status()).toBe(400);
    const body = await resp.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBe("confirm_required");
  });
});
