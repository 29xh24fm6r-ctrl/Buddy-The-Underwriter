import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assessNewBusinessRisk,
  detectNewBusinessFromFacts,
} from "@/lib/sba/newBusinessProtocol";

test("assessNewBusinessRisk: new business (<24mo) gets 1.25x DSCR and a 10% equity floor, not 20%", () => {
  const result = assessNewBusinessRisk({
    yearsInBusiness: 1,
    monthsInBusiness: 12,
    hasBusinessPlan: true,
    managementYearsInIndustry: 5,
    loanType: "7a",
  });
  assert.equal(result.flags.isNewBusiness, true);
  assert.equal(result.flags.requiresProjectedDscr, true);
  assert.equal(result.flags.projectedDscrThreshold, 1.25);
  assert.equal(result.flags.equityInjectionFloor, 0.1);
  assert.equal(result.flags.requiresStartupBusinessPlan, true);
});

test("assessNewBusinessRisk: established business (>=24mo) gets 1.10x DSCR and a 10% equity floor", () => {
  const result = assessNewBusinessRisk({
    yearsInBusiness: 5,
    monthsInBusiness: 60,
    hasBusinessPlan: false,
    managementYearsInIndustry: 10,
    loanType: "7a",
  });
  assert.equal(result.flags.isNewBusiness, false);
  assert.equal(result.flags.requiresProjectedDscr, false);
  assert.equal(result.flags.projectedDscrThreshold, 1.1);
  assert.equal(result.flags.equityInjectionFloor, 0.1);
  assert.equal(result.flags.requiresStartupBusinessPlan, false);
  // No business plan required for an established business, so no blocker.
  assert.equal(result.flags.blockers.length, 0);
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
