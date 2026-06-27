import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildEntityGraph, distributionsInto, distributionsOutOf } from "@/lib/finengine/entityGraph";
import {
  computeGlobalCashFlow,
  worstOfThreeLivingExpenses,
  type BusinessEntityCashFlow,
  type PersonalGuarantorCashFlow,
} from "@/lib/finengine/methods/global";
import type { EntityNode } from "@/lib/finengine/contracts";

// Synthetic multi-OPCO fixture (no live borrower data — Samaritus/OmniCare leak-safe).
const opco1: EntityNode = { id: "opco1", ownerType: "opco", displayName: "OpCo One", form: "S_CORP", isPrimaryOperating: true };
const opco2: EntityNode = { id: "opco2", ownerType: "affiliate", displayName: "OpCo Two", form: "S_CORP" };
const guarantor: EntityNode = { id: "g1", ownerType: "guarantor", displayName: "Guarantor A", form: "INDIVIDUAL", isGuarantor: true };

function fixtureGraph(distA = 120_000, distB = 80_000) {
  return buildEntityGraph(
    [opco1, opco2, guarantor],
    [
      { from: "g1", to: "opco1", type: "ownership", pct: 1 },
      { from: "g1", to: "opco2", type: "ownership", pct: 1 },
      { from: "opco1", to: "g1", type: "distribution", amount: distA },
      { from: "opco2", to: "g1", type: "distribution", amount: distB },
    ],
  );
}

const business: BusinessEntityCashFlow[] = [
  { nodeId: "opco1", operatingCashFlow: 400_000, businessDebtService: 200_000, ncadsProvenance: { nodeId: "opco1", base: "EBITDA", components: { ebitda: 400_000 }, note: "opco1 NCADS" } },
  { nodeId: "opco2", operatingCashFlow: 300_000, businessDebtService: 150_000, ncadsProvenance: { nodeId: "opco2", base: "EBITDA", components: { ebitda: 300_000 }, note: "opco2 NCADS" } },
];

const personal: PersonalGuarantorCashFlow[] = [
  {
    nodeId: "g1",
    income: { wages: 60_000, netRental: 0, investment: 5_000, other: 0 }, // NO distributions here
    personalDebtService: 40_000,
    livingExpenses: { stated: 50_000, fromHousing: 65_000, sbaMinimum: 30_000 },
  },
];

describe("entityGraph", () => {
  it("rejects edges referencing unknown nodes", () => {
    assert.throws(() => buildEntityGraph([opco1], [{ from: "opco1", to: "ghost", type: "distribution", amount: 1 }]));
  });
  it("sums distributions into/out of nodes", () => {
    const g = fixtureGraph();
    assert.equal(distributionsInto(g, "g1"), 200_000);
    assert.equal(distributionsOutOf(g, "opco1"), 120_000);
  });
});

describe("worst-of-three living expenses (most conservative)", () => {
  it("picks the highest of stated / housing / sba-minimum", () => {
    const r = worstOfThreeLivingExpenses({ stated: 50_000, fromHousing: 65_000, sbaMinimum: 30_000 });
    assert.equal(r.value, 65_000);
    assert.equal(r.basis, "from_housing");
  });
});

describe("global cash flow — NO double-count (V3.1)", () => {
  it("counts owner distributions exactly once (global is identical with or without distributions)", () => {
    const withDist = computeGlobalCashFlow(fixtureGraph(120_000, 80_000), business, personal);
    const noDist = computeGlobalCashFlow(fixtureGraph(0, 0), business, personal);
    // distributions are internal transfers — they do NOT change global cash flow
    assert.equal(withDist.globalCashBeforeDebt, noDist.globalCashBeforeDebt);
    assert.ok(withDist.singleCountVerified);
  });

  it("global = business operating + personal external income − worst-of-three living; DSCR uses ALL global debt service", () => {
    const r = computeGlobalCashFlow(fixtureGraph(), business, personal);
    // business operating 700k; personal income 65k; living 65k → before-debt 700k
    assert.equal(r.businessOperating, 700_000);
    assert.equal(r.totalLivingExpenses, 65_000);
    assert.equal(r.globalCashBeforeDebt, 700_000 + 65_000 - 65_000);
    // global debt service = 200k + 150k business + 40k personal
    assert.equal(r.globalDebtService, 390_000);
    assert.equal(r.globalDSCR, 700_000 / 390_000);
  });

  it("flags a distribution source/use mismatch (guards against re-introducing double-count)", () => {
    // distributions out of business (200k) but graph routes only 120k into personal
    const mismatched = buildEntityGraph(
      [opco1, opco2, guarantor],
      [
        { from: "opco1", to: "g1", type: "distribution", amount: 120_000 },
        { from: "opco2", to: "opco1", type: "distribution", amount: 80_000 }, // not into a personal node
      ],
    );
    const r = computeGlobalCashFlow(mismatched, business, personal);
    assert.equal(r.singleCountVerified, false);
    assert.ok(r.warnings.some((w) => /double-counting/.test(w)));
  });

  it("every NCADS component carries provenance (SR 11-7 audit trail)", () => {
    const r = computeGlobalCashFlow(fixtureGraph(), business, personal);
    assert.equal(r.ncadsProvenance.length, 2);
    for (const p of r.ncadsProvenance) {
      assert.ok(p.nodeId && p.base && p.note);
      assert.ok(Object.keys(p.components).length > 0);
    }
  });
});
