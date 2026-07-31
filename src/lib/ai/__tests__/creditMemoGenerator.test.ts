/**
 * Audit fix regression tests (Borrower Intake Program review) —
 * generateAdvancedCreditMemo's generator call is npiTagged, but unlike
 * every other npiTagged caller in this codebase it has no built-in
 * "degrade gracefully" verifier/translator pattern to fall back on — its
 * own hard-fallback stub memo IS that fallback. These tests lock in that
 * an NPI-refusal (or any other generator failure) degrades to the stub
 * memo rather than throwing out of generateAdvancedCreditMemo entirely.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

mockServerOnly();
const require = createRequire(import.meta.url);

const { generateAdvancedCreditMemo } =
  require("../creditMemoGenerator") as typeof import("../creditMemoGenerator");
const { __setProviderImplForTests, __setLogGatewayCallForTests, __resetGatewayTestOverrides, __resetGatewayBudgetForTests } =
  require("../gateway") as typeof import("../gateway");
const { __setVendorApprovalForTests, __resetVendorApprovalForTests } =
  require("../vendorApproval") as typeof import("../vendorApproval");

test.afterEach(() => {
  __resetGatewayTestOverrides();
  __resetGatewayBudgetForTests();
  __resetVendorApprovalForTests();
});

function validMemoText(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    meta: {
      dealId: "deal-1",
      memoVersion: "v1",
      generatedAt: "2026-07-31T00:00:00.000Z",
      recommendedDecision: "APPROVE",
      confidence: 0.8,
    },
    cockpit: { keyMetrics: {}, riskRadar: [], missingItems: [] },
    sections: [{ id: "general", title: "General & Applicant Information", body: "Looks good." }],
    evidence: [],
    warnings: [],
    ...overrides,
  });
}

test("returns the real memo when the generator call succeeds and is properly npiTagged", async () => {
  __setVendorApprovalForTests("google", "APPROVED");
  const ledgerEntries: any[] = [];
  __setLogGatewayCallForTests(async (entry) => {
    ledgerEntries.push(entry);
  });
  __setProviderImplForTests("google", async () => ({
    text: validMemoText(),
    tokensIn: 100,
    tokensOut: 50,
  }));

  const { memoJson, warnings, isFallbackStub } = await generateAdvancedCreditMemo({
    dealId: "deal-1",
    context: { borrower: { name: "Acme Co" } },
  });

  assert.equal(ledgerEntries.length, 1);
  assert.equal(
    ledgerEntries[0].npiTagged,
    true,
    "generator call must be npiTagged since it embeds real borrower context",
  );
  assert.equal(memoJson.meta.recommendedDecision, "APPROVE");
  assert.deepEqual(warnings, []);
  assert.equal(isFallbackStub, false, "a real, successfully-generated memo must not be marked as a fallback stub");
});

test("degrades to the hard-fallback stub memo (not a throw) on the real NPI gate — all vendors PENDING by default", async () => {
  // Deliberately NOT approving any vendor — exercises the real gate.
  const { memoJson, warnings, isFallbackStub } = await generateAdvancedCreditMemo({
    dealId: "deal-2",
    context: { borrower: { name: "Acme Co" } },
  });

  assert.equal(memoJson.meta.recommendedDecision, "PENDING - MISSING INFO");
  assert.equal(memoJson.meta.dealId, "deal-2");
  assert.match(warnings[0], /Generator call failed/);
  // SPEC-TRIDENT-FIX-VERIFY-AND-REDO-V1 — this is the flag callers (the
  // banker-facing credit-memo panel) must surface so a stub is never
  // visually indistinguishable from a real AI-generated memo.
  assert.equal(isFallbackStub, true);
});

test("degrades to the hard-fallback stub memo when the generator call fails for a reason other than the NPI gate", async () => {
  __setVendorApprovalForTests("google", "APPROVED");
  __setVendorApprovalForTests("openai", "APPROVED");
  __setProviderImplForTests("google", async () => {
    throw new Error("simulated provider outage");
  });
  __setProviderImplForTests("openai", async () => {
    throw new Error("simulated provider outage");
  });

  const { memoJson, warnings, isFallbackStub } = await generateAdvancedCreditMemo({
    dealId: "deal-3",
    context: {},
  });

  assert.equal(memoJson.meta.recommendedDecision, "PENDING - MISSING INFO");
  assert.match(warnings[0], /Generator call failed/);
  assert.equal(isFallbackStub, true);
});

test("falls back to the stub memo (schema-validation message, not the call-failure message) when both attempts return unparseable JSON", async () => {
  __setVendorApprovalForTests("google", "APPROVED");
  __setProviderImplForTests("google", async () => ({
    text: "not valid json at all",
    tokensIn: 10,
    tokensOut: 10,
  }));

  const { memoJson, warnings, isFallbackStub } = await generateAdvancedCreditMemo({
    dealId: "deal-4",
    context: {},
  });

  assert.equal(memoJson.meta.recommendedDecision, "PENDING - MISSING INFO");
  assert.match(warnings[0], /schema validation twice/);
  assert.equal(isFallbackStub, true, "a schema-validation-failure fallback is still a stub, not real content");
});

test("attempt 2 (repair) recovers when attempt 1 returns malformed JSON but attempt 2 returns valid JSON", async () => {
  __setVendorApprovalForTests("google", "APPROVED");
  let callCount = 0;
  __setProviderImplForTests("google", async () => {
    callCount += 1;
    if (callCount === 1) return { text: "not valid json", tokensIn: 10, tokensOut: 10 };
    return { text: validMemoText({ meta: { dealId: "deal-5", memoVersion: "v1", generatedAt: "2026-07-31T00:00:00.000Z", recommendedDecision: "DECLINE", confidence: 0.6 } }), tokensIn: 10, tokensOut: 10 };
  });

  const { memoJson, isFallbackStub } = await generateAdvancedCreditMemo({ dealId: "deal-5", context: {} });
  assert.equal(callCount, 2);
  assert.equal(memoJson.meta.recommendedDecision, "DECLINE");
  assert.equal(isFallbackStub, false, "a repair-recovered real memo must not be marked as a fallback stub");
});
