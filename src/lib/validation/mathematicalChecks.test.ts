/**
 * Phase 53 — Mathematical Checks Tests (Deterministic)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runMathematicalChecks } from "./mathematicalChecks";

describe("runMathematicalChecks", () => {
  it("passes when balance sheet balances", () => {
    const checks = runMathematicalChecks({
      TOTAL_ASSETS: 1000000,
      TOTAL_LIABILITIES: 600000,
      NET_WORTH: 400000,
    });
    const bsCheck = checks.find((c) => c.name === "Balance sheet balances");
    assert.ok(bsCheck);
    assert.equal(bsCheck.status, "PASS");
  });

  it("blocks when balance sheet imbalanced", () => {
    const checks = runMathematicalChecks({
      TOTAL_ASSETS: 1000000,
      TOTAL_LIABILITIES: 600000,
      NET_WORTH: 200000, // Should be 400000
    });
    const bsCheck = checks.find((c) => c.name === "Balance sheet balances");
    assert.ok(bsCheck);
    assert.equal(bsCheck.status, "BLOCK");
  });

  it("passes DSCR reconciliation", () => {
    const checks = runMathematicalChecks({
      CASH_FLOW_AVAILABLE: 150000,
      ANNUAL_DEBT_SERVICE: 100000,
      DSCR: 1.5,
    });
    const dscrCheck = checks.find((c) => c.name === "DSCR reconciliation");
    assert.ok(dscrCheck);
    assert.equal(dscrCheck.status, "PASS");
  });

  it("blocks when DSCR doesn't reconcile", () => {
    const checks = runMathematicalChecks({
      CASH_FLOW_AVAILABLE: 150000,
      ANNUAL_DEBT_SERVICE: 100000,
      DSCR: 3.0, // Should be 1.5
    });
    const dscrCheck = checks.find((c) => c.name === "DSCR reconciliation");
    assert.ok(dscrCheck);
    assert.equal(dscrCheck.status, "BLOCK");
  });

  it("blocks negative current ratio", () => {
    const checks = runMathematicalChecks({ CURRENT_RATIO: -0.5 });
    const crCheck = checks.find((c) => c.name === "Current ratio sign check");
    assert.ok(crCheck);
    assert.equal(crCheck.status, "BLOCK");
  });

  it("same input always produces same output (deterministic)", () => {
    const facts = { TOTAL_ASSETS: 500, TOTAL_LIABILITIES: 300, NET_WORTH: 200, DSCR: 1.25, CASH_FLOW_AVAILABLE: 125, ANNUAL_DEBT_SERVICE: 100 };
    const r1 = runMathematicalChecks(facts);
    const r2 = runMathematicalChecks(facts);
    assert.deepEqual(r1, r2);
  });
});
