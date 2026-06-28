/**
 * SPEC-FINENGINE-PRODUCT-DEPTH-AND-SIZING-1 — Workstream E: per-property NOI.
 *
 * FIXTURE-TESTED ONLY — `deal_rent_roll_rows` is empty (0 live rows, §0), so this
 * model produces no live numbers until rent-roll extraction populates rows. The
 * loader is exercised with injected loaders (no DB). Single-property path only —
 * the rows carry no `property_id` (multiPropertyRepresentable: false).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { computePropertyNoi, sizeCreFromRentRoll, type RentRollUnit } from "@/lib/finengine/sizing/propertyNoi";
import { loadPropertyNoiInputs } from "@/lib/finengine/sizing/loadPropertyNoiInputs";

// A 4-unit single-property rent roll; one unit vacant.
const rentRoll: RentRollUnit[] = [
  { unitId: "1", monthlyRent: 2_000, occupancyStatus: "occupied", concessionsMonthly: 0 },
  { unitId: "2", monthlyRent: 2_000, occupancyStatus: "occupied", concessionsMonthly: 100 },
  { unitId: "3", monthlyRent: 2_500, occupancyStatus: "occupied", concessionsMonthly: 0 },
  { unitId: "4", monthlyRent: 2_500, occupancyStatus: "vacant", concessionsMonthly: 0 },
];

describe("Workstream E — computePropertyNoi (fixtures)", () => {
  it("computes NOI = GPR − vacancy − concessions − opex (occupancy-driven vacancy)", () => {
    // GPR = (2000+2000+2500+2500)×12 = 108,000. Vacant unit 4 → vacancy 2500×12 = 30,000.
    // concessions = 100×12 = 1,200. EGI = 108,000 − 30,000 − 1,200 = 76,800. opex 20,000 → NOI 56,800.
    const r = computePropertyNoi(rentRoll, { operatingExpenses: 20_000 })!;
    assert.equal(r.grossPotentialRent, 108_000);
    assert.equal(r.vacancyLoss, 30_000);
    assert.equal(r.vacancyBasis, "occupancy_status");
    assert.equal(r.concessions, 1_200);
    assert.equal(r.effectiveGrossIncome, 76_800);
    assert.equal(r.noi, 56_800);
    assert.equal(r.vacantUnits, 1);
    assert.equal(r.occupiedUnits, 3);
  });

  it("uses an explicit vacancy factor when supplied (GPR × factor)", () => {
    // vacancy_factor 0.05 → vacancy = 108,000 × 0.05 = 5,400.
    const r = computePropertyNoi(rentRoll, { operatingExpenses: 20_000, vacancyFactor: 0.05 })!;
    assert.equal(r.vacancyLoss, 5_400);
    assert.equal(r.vacancyBasis, "vacancy_factor");
    assert.equal(r.noi, 108_000 - 5_400 - 1_200 - 20_000); // 81,400
  });

  it("falls back to annual_rent when monthly_rent is absent", () => {
    const r = computePropertyNoi([{ unitId: "1", annualRent: 60_000, occupancyStatus: "occupied" }], { operatingExpenses: 0 })!;
    assert.equal(r.grossPotentialRent, 60_000);
  });

  it("an empty rent roll returns null (the live 'no rent-roll data' state today)", () => {
    assert.equal(computePropertyNoi([], { operatingExpenses: 20_000 }), null);
  });

  it("feeds the rent-roll NOI into sizeCre (per-property CRE leg)", () => {
    const { noi, sizing } = sizeCreFromRentRoll({
      rows: rentRoll,
      operatingExpenses: 20_000,
      propertyValue: 1_000_000,
      annualConstantRate: 0.075,
    });
    assert.equal(noi!.noi, 56_800);
    assert.ok(sizing!.maxLoan != null);
    assert.ok(sizing!.bindingConstraint); // LTV / DSCR / debt-yield from the NOI
  });

  it("sizeCreFromRentRoll returns null sizing on an empty rent roll", () => {
    const { noi, sizing } = sizeCreFromRentRoll({ rows: [], operatingExpenses: 20_000, propertyValue: 1_000_000, annualConstantRate: 0.075 });
    assert.equal(noi, null);
    assert.equal(sizing, null);
  });
});

describe("Workstream E — loadPropertyNoiInputs (injected loaders, no DB)", () => {
  it("computes NOI from injected rent-roll + collateral; single-property only", async () => {
    const r = await loadPropertyNoiInputs("deal-1", {
      operatingExpenses: 20_000,
      loaders: {
        loadRentRoll: async () => rentRoll,
        loadCollateral: async () => ({ appraisedValue: 1_000_000, marketValue: 900_000 }),
      },
    });
    assert.equal(r.multiPropertyRepresentable, false); // no property_id in schema (§0 STOP)
    assert.equal(r.rentRollUnitCount, 4);
    assert.equal(r.noi!.noi, 56_800);
    assert.equal(r.propertyValue, 1_000_000); // appraised preferred over market
    assert.equal(r.noRentRollData, false);
  });

  it("reports noRentRollData + null NOI for the live state (0 rows today)", async () => {
    const r = await loadPropertyNoiInputs("omnicare", {
      operatingExpenses: 20_000,
      loaders: { loadRentRoll: async () => [], loadCollateral: async () => ({ appraisedValue: null, marketValue: null }) },
    });
    assert.equal(r.noRentRollData, true);
    assert.equal(r.noi, null);
    assert.equal(r.propertyValue, null);
  });
});
