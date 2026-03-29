/**
 * Phase 53 — Completeness Checks Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCompletenessChecks } from "./completenessChecks";

describe("runCompletenessChecks", () => {
  it("passes when all operating company fields present", () => {
    const checks = runCompletenessChecks({
      TOTAL_REVENUE: 1000000, NET_INCOME: 100000, ANNUAL_DEBT_SERVICE: 50000,
      DSCR: 2.0, CASH_FLOW_AVAILABLE: 100000,
      TOTAL_ASSETS: 500000, TOTAL_LIABILITIES: 300000, NET_WORTH: 200000,
    }, "operating_company");
    assert.equal(checks[0].status, "PASS");
  });

  it("flags when 1-2 fields missing", () => {
    const checks = runCompletenessChecks({
      TOTAL_REVENUE: 1000000, NET_INCOME: 100000,
      DSCR: 2.0, CASH_FLOW_AVAILABLE: 100000,
      TOTAL_ASSETS: 500000, TOTAL_LIABILITIES: 300000, NET_WORTH: 200000,
      // Missing: ANNUAL_DEBT_SERVICE
    }, "operating_company");
    assert.equal(checks[0].status, "FLAG");
  });

  it("blocks when 3+ fields missing", () => {
    const checks = runCompletenessChecks({
      TOTAL_REVENUE: 1000000,
    }, "operating_company");
    assert.equal(checks[0].status, "BLOCK");
  });

  it("checks real estate specific fields", () => {
    const checks = runCompletenessChecks({
      NOI_TTM: 200000, ANNUAL_DEBT_SERVICE: 150000, DSCR: 1.33,
      OCCUPANCY_PCT: 0.95, COLLATERAL_GROSS_VALUE: 3000000, LTV_GROSS: 0.67,
      TOTAL_ASSETS: 3000000, TOTAL_LIABILITIES: 2000000, NET_WORTH: 1000000,
    }, "real_estate");
    assert.equal(checks[0].status, "PASS");
  });
});
