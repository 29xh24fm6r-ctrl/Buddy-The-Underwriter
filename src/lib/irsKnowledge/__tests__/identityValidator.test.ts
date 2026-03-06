/**
 * IRS Knowledge Base — Identity Validator Tests
 *
 * Validates the IRS accounting identity checks that gate spread accuracy.
 * Test 3 explicitly catches the OBI-as-revenue bug found in production.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import Module from "node:module";

// Stub "server-only" so identityValidator imports don't throw in test context.
const emptyJs = path.resolve("node_modules/server-only/empty.js");
const originalResolve = (Module as any)._resolveFilename;
(Module as any)._resolveFilename = function (
  request: string,
  ...args: any[]
) {
  if (request === "server-only") {
    return emptyJs;
  }
  return originalResolve.call(this, request, ...args);
};

describe("IRS Knowledge Base — Identity Validator", async () => {
  const { validateDocumentFacts, isSpreadGenerationAllowed } = await import("../identityValidator");
  const { getForm1065Spec } = await import("../formSpecs/form1065");

  // Test 1: 2022 1065 — all checks pass
  it("2022 1065 with correct values returns VERIFIED", () => {
    const spec = getForm1065Spec(2022);
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 797989,
      COST_OF_GOODS_SOLD: 0,
      GROSS_PROFIT: 797989,
      TOTAL_INCOME: 797989,
      TOTAL_DEDUCTIONS: 472077,
      ORDINARY_BUSINESS_INCOME: 325912,
    };

    const result = validateDocumentFacts("doc-2022", spec, facts);

    assert.equal(result.status, "VERIFIED");
    assert.equal(result.passedCount, 2); // gross profit + OBI checks
    assert.equal(result.failedCount, 0);
    assert.equal(result.skippedCount, 1); // balance sheet check skipped (no BS facts)
    assert.ok(result.summary.includes("identity checks passed"));
  });

  // Test 2: 2024 1065 — all checks pass (OBI on line 23)
  it("2024 1065 with correct values returns VERIFIED", () => {
    const spec = getForm1065Spec(2024);
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 1502871,
      COST_OF_GOODS_SOLD: 449671,
      GROSS_PROFIT: 1053200,
      TOTAL_INCOME: 1053200,
      TOTAL_DEDUCTIONS: 783384,
      ORDINARY_BUSINESS_INCOME: 269816,
    };

    const result = validateDocumentFacts("doc-2024", spec, facts);

    assert.equal(result.status, "VERIFIED");
    assert.equal(result.passedCount, 2);
    assert.equal(result.failedCount, 0);
  });

  // Test 3: Extraction error — OBI used as revenue (the bug we found)
  // When the extractor confuses OBI with revenue, both gross profit and OBI
  // identity checks fail because the wrong top-line cascades through.
  it("OBI-as-revenue extraction error returns BLOCKED", () => {
    const spec = getForm1065Spec(2024);
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 269816,       // WRONG — this is OBI, not revenue (should be 1,502,871)
      COST_OF_GOODS_SOLD: 449671,   // Correct from return
      GROSS_PROFIT: 1053200,        // Correct from return — but won't match wrong GROSS_RECEIPTS
      TOTAL_INCOME: 269816,         // Also wrong — polluted by same OBI confusion
      TOTAL_DEDUCTIONS: 783384,     // Correct from return
      ORDINARY_BUSINESS_INCOME: 269816,
    };

    const result = validateDocumentFacts("doc-bug", spec, facts);

    // GP check: 269816 ≠ 449671 + 1053200 = 1502871 → FAILS
    // OBI check: 269816 ≠ 783384 + 269816 = 1053200 → FAILS
    // Both required checks fail → BLOCKED
    assert.equal(result.status, "BLOCKED");
    assert.ok(result.failedCount >= 2);
    assert.ok(result.summary.includes("FAILED"));

    // Spread generation should be blocked
    const gate = isSpreadGenerationAllowed([result]);
    assert.equal(gate.allowed, false);
  });

  // Test 4: Missing COGS (service business — null treated as valid)
  it("service business with null COGS returns VERIFIED", () => {
    const spec = getForm1065Spec(2022);
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 500000,
      COST_OF_GOODS_SOLD: null,     // Service business — no COGS
      GROSS_PROFIT: 500000,
      TOTAL_INCOME: 500000,
      TOTAL_DEDUCTIONS: 300000,
      ORDINARY_BUSINESS_INCOME: 200000,
    };

    const result = validateDocumentFacts("doc-service", spec, facts);

    // Gross profit check: COGS is null → skipped (missing fact)
    // OBI check: 500000 = 300000 + 200000 ✓
    // With one required check passed and one skipped, should not be BLOCKED
    assert.notEqual(result.status, "BLOCKED");
    assert.ok(result.passedCount >= 1);
  });

  // Test 5: Balance sheet check with missing Schedule L
  it("missing Schedule L data skips BS check, other checks pass → VERIFIED", () => {
    const spec = getForm1065Spec(2022);
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 797989,
      COST_OF_GOODS_SOLD: 0,
      GROSS_PROFIT: 797989,
      TOTAL_INCOME: 797989,
      TOTAL_DEDUCTIONS: 472077,
      ORDINARY_BUSINESS_INCOME: 325912,
      // No TOTAL_ASSETS, TOTAL_LIABILITIES, TOTAL_EQUITY — Schedule L not filed
    };

    const result = validateDocumentFacts("doc-no-schedL", spec, facts);

    assert.equal(result.status, "VERIFIED");

    // Balance sheet check should be skipped
    const bsCheck = result.checkResults.find(r => r.checkId === "1065_2022_BALANCE_SHEET");
    assert.ok(bsCheck);
    assert.equal(bsCheck.skipped, true);
    assert.ok(bsCheck.skipReason?.includes("Missing facts"));

    // Required IS checks should pass
    assert.equal(result.passedCount, 2);
    assert.equal(result.skippedCount, 1);
  });
});
