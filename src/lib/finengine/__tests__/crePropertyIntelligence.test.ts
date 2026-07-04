/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 9 tests.
 *
 * Owner-occupied and investor CRE, vacancy stress, cap-rate stress, LTV/LTC,
 * DSCR, tenant concentration, lease rollover, appraisal freshness.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  computePropertyIntelligence,
  MIN_STRESS_VACANCY,
  type LeaseUnit,
} from "@/lib/finengine/cre";

const unit = (o: Partial<LeaseUnit> & { tenantId: string; annualBaseRent: number }): LeaseUnit => ({
  occupied: true,
  ...o,
});

describe("PR9 — investor CRE (multi-tenant)", () => {
  const p = computePropertyIntelligence({
    occupancyType: "INVESTOR",
    rentRoll: [
      unit({ tenantId: "T1", annualBaseRent: 200_000, leaseEndMonthsFromNow: 8 }),
      unit({ tenantId: "T2", annualBaseRent: 150_000, leaseEndMonthsFromNow: 30 }),
      unit({ tenantId: "T3", annualBaseRent: 150_000, leaseEndMonthsFromNow: 48 }),
      unit({ tenantId: "T4", annualBaseRent: 100_000, occupied: false }),
    ],
    operatingExpenses: 180_000,
    marketVacancyPct: 0.08,
    capRate: 0.07,
    appraisedValue: 6_000_000,
    appraisalAgeMonths: 6,
    loanAmount: 4_000_000,
    annualDebtService: 300_000,
  });

  it("computes GPR, occupied rent, physical vacancy", () => {
    assert.equal(p.grossPotentialRent, 600_000);
    assert.equal(p.occupiedRent, 500_000); // T4 vacant
    assert.ok(Math.abs(p.physicalVacancyPct - 100_000 / 600_000) < 1e-9);
  });

  it("stress vacancy is at least the floor and NOI stresses down", () => {
    assert.ok(p.stressVacancyPct >= MIN_STRESS_VACANCY);
    assert.ok(p.stressedNoi < p.normalizedNoi);
  });

  it("income approach value + cap-rate-stress value", () => {
    assert.equal(p.incomeApproachValue, p.normalizedNoi / 0.07);
    assert.ok(p.stressedIncomeApproachValue! < p.incomeApproachValue!);
  });

  it("LTV and stressed LTV", () => {
    assert.ok(Math.abs(p.ltv! - 4_000_000 / 6_000_000) < 1e-9);
    assert.ok(p.stressedLtv! > p.ltv!); // value falls under stress → LTV rises
  });

  it("tenant concentration + near-term rollover flagged", () => {
    assert.ok(Math.abs(p.tenantConcentrationTop - 200_000 / 600_000) < 1e-9);
    assert.ok(p.rollover12moPct > 0); // T1 expires in 8mo
    assert.ok(p.concerns.includes("high_near_term_lease_rollover") || p.rollover12moPct < 0.25);
  });
});

describe("PR9 — owner-occupied CRE", () => {
  const p = computePropertyIntelligence({
    occupancyType: "OWNER_OCCUPIED",
    rentRoll: [unit({ tenantId: "OPCO", annualBaseRent: 300_000, leaseEndMonthsFromNow: 120 })],
    operatingExpenses: 60_000,
    capRate: 0.075,
    appraisedValue: 3_000_000,
    appraisalAgeMonths: 20, // stale
    loanAmount: 2_100_000,
    totalProjectCost: 2_800_000,
    annualDebtService: 190_000,
  });

  it("flags repayment dependence on the operating business", () => {
    assert.ok(p.concerns.includes("owner_occupied_repayment_depends_on_operating_business"));
  });

  it("flags stale appraisal", () => {
    assert.equal(p.appraisalFresh, false);
    assert.ok(p.concerns.includes("stale_appraisal"));
  });

  it("computes LTC and DSCR", () => {
    assert.ok(Math.abs(p.ltc! - 2_100_000 / 2_800_000) < 1e-9);
    assert.ok(Math.abs(p.dscr! - (300_000 - 60_000) / 190_000) < 1e-9);
  });
});

describe("PR9 — degradation + environmental", () => {
  it("no cap rate → no income-approach value, concern raised", () => {
    const p = computePropertyIntelligence({
      occupancyType: "INVESTOR",
      rentRoll: [unit({ tenantId: "T", annualBaseRent: 100_000 })],
      operatingExpenses: 30_000,
    });
    assert.equal(p.incomeApproachValue, null);
    assert.ok(p.concerns.includes("no_cap_rate_for_income_approach"));
    assert.equal(p.ltv, null);
  });

  it("environmental flags surface", () => {
    const p = computePropertyIntelligence({
      occupancyType: "INVESTOR",
      rentRoll: [unit({ tenantId: "T", annualBaseRent: 100_000 })],
      operatingExpenses: 30_000,
      environmentalFlags: ["phase_1_recognized_environmental_condition"],
    });
    assert.equal(p.environmentalConcerns.length, 1);
    assert.ok(p.concerns.includes("environmental_flags_present"));
  });

  it("is independent of the C&I EBITDA path (no operating-earnings inputs)", () => {
    // Sanity: the property engine consumes only property inputs.
    const p = computePropertyIntelligence({
      occupancyType: "INVESTOR",
      rentRoll: [unit({ tenantId: "T", annualBaseRent: 100_000 })],
      operatingExpenses: 40_000,
      capRate: 0.06,
    });
    assert.equal(p.normalizedNoi, 60_000);
  });
});
