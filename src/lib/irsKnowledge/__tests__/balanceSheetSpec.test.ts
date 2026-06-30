/**
 * SPEC-BALANCE-SHEET-INTEGRITY-GATE-1 — balance-sheet integrity check + severity.
 *
 * Covers:
 *  - getBalanceSheetSpec + validateDocumentFacts (foots → VERIFIED; off > $1 →
 *    FLAGGED via flag severity, NOT BLOCKED; missing operand → PARTIAL).
 *  - determineStatus severity split (block-severity required failure still BLOCKED;
 *    flag-severity required failure → FLAGGED even when the only required check).
 *
 * Numbers are the live OmniCare eefd62b3 balance sheets (spec §PIV).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mockServerOnly } from "../../../../test/utils/mockServerOnly";

// Stub "server-only" so transitive imports don't throw in test context.
mockServerOnly();

describe("Balance-sheet integrity check + severity", async () => {
  const { validateDocumentFacts } = await import("../identityValidator");
  const { getBalanceSheetSpec } = await import("../formSpecs/balanceSheet");
  const { getForm1120Spec } = await import("../formSpecs/form1120");

  // ── getBalanceSheetSpec + validateDocumentFacts ─────────────────────────

  it("[bsi-1] Dec-2025 balance sheet foots → BALANCE_SHEET_IDENTITY passed, VERIFIED", () => {
    const spec = getBalanceSheetSpec(2025);
    const facts: Record<string, number | null> = {
      TOTAL_ASSETS: 3342585.66,
      TOTAL_LIABILITIES: 140450.71,
      TOTAL_EQUITY: 3202134.95,
    };
    const result = validateDocumentFacts("doc-bs-2025", spec, facts);

    assert.equal(result.status, "VERIFIED");
    assert.equal(result.formType, "BALANCE_SHEET");
    assert.equal(result.taxYear, 2025);
    assert.equal(result.passedCount, 1);
    assert.equal(result.failedCount, 0);
    const check = result.checkResults.find(r => r.checkId === "BALANCE_SHEET_IDENTITY");
    assert.ok(check);
    assert.equal(check.passed, true);
    assert.equal(check.skipped, false);
  });

  it("[bsi-2] off by > $1 → check failed, flag severity → FLAGGED (NOT BLOCKED)", () => {
    const spec = getBalanceSheetSpec(2025);
    const facts: Record<string, number | null> = {
      TOTAL_ASSETS: 3342585.66,
      TOTAL_LIABILITIES: 140450.71,
      TOTAL_EQUITY: 3202000.00, // ~$135 short → fails $1 tolerance
    };
    const result = validateDocumentFacts("doc-bs-off", spec, facts);

    assert.equal(result.status, "FLAGGED");
    assert.notEqual(result.status, "BLOCKED");
    assert.equal(result.failedCount, 1);
    const check = result.checkResults.find(r => r.checkId === "BALANCE_SHEET_IDENTITY");
    assert.ok(check);
    assert.equal(check.passed, false);
    assert.equal(check.skipped, false);
  });

  it("[bsi-3] missing TOTAL_EQUITY → check skipped → PARTIAL", () => {
    const spec = getBalanceSheetSpec(2025);
    const facts: Record<string, number | null> = {
      TOTAL_ASSETS: 3342585.66,
      TOTAL_LIABILITIES: 140450.71,
      // TOTAL_EQUITY absent
    };
    const result = validateDocumentFacts("doc-bs-partial", spec, facts);

    assert.equal(result.status, "PARTIAL");
    assert.equal(result.skippedCount, 1);
    const check = result.checkResults.find(r => r.checkId === "BALANCE_SHEET_IDENTITY");
    assert.ok(check);
    assert.equal(check.skipped, true);
    assert.ok(check.skipReason?.includes("TOTAL_EQUITY"));
  });

  it("[bsi-4] Mar-2026 balance sheet foots → VERIFIED (second live period)", () => {
    const spec = getBalanceSheetSpec(2026);
    const facts: Record<string, number | null> = {
      TOTAL_ASSETS: 3501691.40,
      TOTAL_LIABILITIES: 94443.98,
      TOTAL_EQUITY: 3407247.42,
    };
    const result = validateDocumentFacts("doc-bs-2026", spec, facts);
    assert.equal(result.status, "VERIFIED");
    assert.equal(result.taxYear, 2026);
  });

  // ── determineStatus severity (regression-critical) ──────────────────────

  it("[bsi-5] block-severity required failure with no pass still → BLOCKED (tax-return unchanged)", () => {
    // FORM_1120 required checks carry NO severity → default "block". Construct facts
    // where both required identities fail and none pass → BLOCKED, as before.
    const spec = getForm1120Spec(2024);
    const facts: Record<string, number | null> = {
      GROSS_RECEIPTS: 100,
      COST_OF_GOODS_SOLD: 0,
      GROSS_PROFIT: 999,      // 100 ≠ 0 + 999 → 1120_GROSS_PROFIT fails
      TOTAL_INCOME: 100,
      TOTAL_DEDUCTIONS: 0,
      TAXABLE_INCOME: 999,    // 100 ≠ 0 + 999 → 1120_TAXABLE_INCOME fails
    };
    const result = validateDocumentFacts("doc-1120-block", spec, facts);
    assert.equal(result.status, "BLOCKED");
  });

  it("[bsi-6] flag-severity required failure → FLAGGED even when only required check", () => {
    // The balance-sheet spec has exactly one required check, severity "flag".
    const spec = getBalanceSheetSpec(2025);
    const facts: Record<string, number | null> = {
      TOTAL_ASSETS: 1000,
      TOTAL_LIABILITIES: 1,
      TOTAL_EQUITY: 1, // 1000 ≠ 2 → fails, but flag severity
    };
    const result = validateDocumentFacts("doc-bs-only-flag", spec, facts);
    assert.equal(result.status, "FLAGGED");
    assert.notEqual(result.status, "BLOCKED");
  });
});
