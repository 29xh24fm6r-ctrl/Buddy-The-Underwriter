import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessNewBusinessRisk,
  detectNewBusinessFromFacts,
} from "@/lib/sba/newBusinessProtocol";

// DSCR/equity-injection thresholds now resolve from finengine's policy
// registry (single source of truth, SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 /
// directive 2026-07-14) instead of being hardcoded in this file. These
// tests pin the resolution given a specific loanType + loanAmount so the
// productId → registry-axis mapping (resolveProductId) is exercised
// explicitly, not just its outcome.

test("assessNewBusinessRisk: new business (<24mo) gets the uniform 1.25x new-business DSCR floor regardless of loan size, and a 10% equity floor", () => {
  const result = assessNewBusinessRisk({
    yearsInBusiness: 1,
    monthsInBusiness: 12,
    hasBusinessPlan: true,
    managementYearsInIndustry: 5,
    loanType: "7a",
    loanAmount: 200_000, // would be SBA_7A_SMALL if this were an existing business
  });
  assert.equal(result.flags.isNewBusiness, true);
  assert.equal(result.flags.requiresProjectedDscr, true);
  assert.equal(result.flags.projectedDscrThreshold, 1.25);
  assert.equal(result.flags.equityInjectionFloor, 0.1);
  assert.equal(result.flags.requiresStartupBusinessPlan, true);
});

test("assessNewBusinessRisk: established SBA_7A_SMALL loan (<=$350k) resolves the small-loan DSCR floor (1.2x), not the flat legacy 1.1x", () => {
  const result = assessNewBusinessRisk({
    yearsInBusiness: 5,
    monthsInBusiness: 60,
    hasBusinessPlan: false,
    managementYearsInIndustry: 10,
    loanType: "7a",
    loanAmount: 200_000,
  });
  assert.equal(result.flags.isNewBusiness, false);
  assert.equal(result.flags.requiresProjectedDscr, false);
  assert.equal(result.flags.projectedDscrThreshold, 1.2);
  assert.equal(result.flags.equityInjectionFloor, 0.1);
  assert.equal(result.flags.requiresStartupBusinessPlan, false);
  // No business plan required for an established business, so no blocker.
  assert.equal(result.flags.blockers.length, 0);
});

test("assessNewBusinessRisk: established SBA_7A_STANDARD loan (>$350k) resolves the standard-tier DSCR floor (1.25x)", () => {
  const result = assessNewBusinessRisk({
    yearsInBusiness: 5,
    monthsInBusiness: 60,
    hasBusinessPlan: false,
    managementYearsInIndustry: 10,
    loanType: "7a",
    loanAmount: 600_000,
  });
  assert.equal(result.flags.projectedDscrThreshold, 1.25);
});

test("assessNewBusinessRisk: SBA 504 program resolves the 504 DSCR floor (1.25x) regardless of loan amount", () => {
  const result = assessNewBusinessRisk({
    yearsInBusiness: 5,
    monthsInBusiness: 60,
    hasBusinessPlan: false,
    managementYearsInIndustry: 10,
    loanType: "504",
    loanAmount: 200_000, // 504 has no small/standard split, unlike 7(a)
  });
  assert.equal(result.flags.projectedDscrThreshold, 1.25);
});

test("assessNewBusinessRisk: unknown/unspecified program falls back to the registry's flat definition", () => {
  const result = assessNewBusinessRisk({
    yearsInBusiness: 5,
    monthsInBusiness: 60,
    hasBusinessPlan: false,
    managementYearsInIndustry: 10,
    loanType: "conventional",
  });
  assert.equal(result.flags.projectedDscrThreshold, 1.2); // flat institutionalOverlay
});

test("assessNewBusinessRisk: new business without a business plan is blocked", () => {
  const result = assessNewBusinessRisk({
    yearsInBusiness: 0.5,
    monthsInBusiness: 6,
    hasBusinessPlan: false,
    managementYearsInIndustry: null,
    loanType: "7a",
  });
  assert.equal(result.flags.blockers.length, 1);
  assert.match(result.flags.blockers[0], /business plan/i);
  assert.equal(result.flags.warnings.length, 1);
  assert.match(result.flags.warnings[0], /not documented/i);
});

test("assessNewBusinessRisk: months === null defaults to ESTABLISHED (conservative, not startup)", () => {
  const result = assessNewBusinessRisk({
    yearsInBusiness: null,
    monthsInBusiness: null,
    hasBusinessPlan: false,
    managementYearsInIndustry: null,
    loanType: "7a",
  });
  assert.equal(result.flags.isNewBusiness, false);
  assert.equal(result.riskFactorLabel, "ESTABLISHED");
});

test("detectNewBusinessFromFacts: MONTHS_IN_BUSINESS takes precedence over YEARS_IN_BUSINESS", () => {
  const { monthsInBusiness } = detectNewBusinessFromFacts([
    { fact_key: "MONTHS_IN_BUSINESS", value_numeric: 8, value_text: null },
    { fact_key: "YEARS_IN_BUSINESS", value_numeric: 5, value_text: null },
  ]);
  assert.equal(monthsInBusiness, 8);
});

test("detectNewBusinessFromFacts: falls back to YEARS_IN_BUSINESS * 12 (the only key the Brokerage concierge actually writes today)", () => {
  const { monthsInBusiness, yearsInBusiness } = detectNewBusinessFromFacts([
    { fact_key: "YEARS_IN_BUSINESS", value_numeric: 1.5, value_text: null },
  ]);
  assert.equal(monthsInBusiness, 18);
  assert.equal(yearsInBusiness, 1.5);
});

test("detectNewBusinessFromFacts: falls back to BUSINESS_DATE_FORMED when no numeric facts present", () => {
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const { monthsInBusiness } = detectNewBusinessFromFacts([
    {
      fact_key: "BUSINESS_DATE_FORMED",
      value_numeric: null,
      value_text: oneYearAgo.toISOString().slice(0, 10),
    },
  ]);
  assert.ok(monthsInBusiness != null && monthsInBusiness >= 11 && monthsInBusiness <= 13);
});

test("detectNewBusinessFromFacts: no facts at all -> both null", () => {
  const result = detectNewBusinessFromFacts([]);
  assert.equal(result.monthsInBusiness, null);
  assert.equal(result.yearsInBusiness, null);
});
