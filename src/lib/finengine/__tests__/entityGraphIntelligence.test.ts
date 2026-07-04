/**
 * SPEC-BUDDY-FINANCIAL-ENGINE-ELITE-1 — PR 13 tests.
 *
 * Multi-entity guarantor/affiliate structure: exposure roll-up by relationship
 * and GCF consumption of the relationship graph.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildRelationshipGraph,
  rollUpExposureByRelationship,
  toGcfEntities,
  rollUpGlobalCashFlow,
  type ExposureNode,
  type ExposureEdge,
} from "@/lib/finengine/entityGraphIntelligence";

// OpCo borrows; Guarantor (owner) personally guarantees + cross-guarantees an affiliate.
const nodes: ExposureNode[] = [
  { id: "opco", role: "OPERATING_COMPANY", annualCashFlow: 900_000, annualDebtService: 500_000 },
  { id: "affiliate", role: "AFFILIATE", annualCashFlow: 300_000, annualDebtService: 200_000 },
  { id: "epc", role: "EPC", annualCashFlow: 120_000, annualDebtService: 100_000 },
  { id: "owner", role: "GUARANTOR", annualCashFlow: 150_000, annualDebtService: 60_000 },
  { id: "spouse", role: "SPOUSE", annualCashFlow: 80_000, annualDebtService: 0 },
  { id: "landlord", role: "LANDLORD" }, // no cash flow into GCF
];

const edges: ExposureEdge[] = [
  { from: "opco", to: "opco", type: "DIRECT_OBLIGATION", amount: 3_000_000 },
  { from: "owner", to: "opco", type: "CROSS_GUARANTEE", amount: 3_000_000 },
  { from: "owner", to: "affiliate", type: "CROSS_GUARANTEE", amount: 1_500_000 },
  { from: "opco", to: "affiliate", type: "SHARED_DEBT", amount: 500_000 },
  { from: "owner", to: "affiliate", type: "CONTINGENT_LIABILITY", amount: 250_000 },
];

const graph = buildRelationshipGraph(nodes, edges);

describe("PR13 — graph construction", () => {
  it("rejects edges referencing unknown nodes", () => {
    assert.throws(() => buildRelationshipGraph([{ id: "a", role: "BORROWER" }], [{ from: "a", to: "z", type: "SHARED_DEBT" }]));
  });
});

describe("PR13 — exposure roll-up by relationship", () => {
  it("rolls up the guarantor's total exposure across cross-guarantees + contingent", () => {
    const r = rollUpExposureByRelationship(graph, "owner");
    assert.equal(r.crossGuaranteed, 3_000_000 + 1_500_000);
    assert.equal(r.contingent, 250_000);
    assert.equal(r.total, 3_000_000 + 1_500_000 + 250_000);
    assert.ok(r.reached.includes("opco"));
    assert.ok(r.reached.includes("affiliate"));
  });

  it("opco direct + shared debt exposure", () => {
    const r = rollUpExposureByRelationship(graph, "opco");
    assert.equal(r.direct, 3_000_000);
    assert.equal(r.sharedDebt, 500_000);
  });

  it("counts only the entity's own outbound edges (no double-count in a mutual guarantee)", () => {
    const cyc = buildRelationshipGraph(
      [
        { id: "a", role: "OPERATING_COMPANY" },
        { id: "b", role: "AFFILIATE" },
      ],
      [
        { from: "a", to: "b", type: "CROSS_GUARANTEE", amount: 100 },
        { from: "b", to: "a", type: "CROSS_GUARANTEE", amount: 100 },
      ],
    );
    // a is on the hook only for what a guarantees (a→b = 100), not b's guarantee of a.
    assert.equal(rollUpExposureByRelationship(cyc, "a").crossGuaranteed, 100);
    assert.equal(rollUpExposureByRelationship(cyc, "b").crossGuaranteed, 100);
  });
});

describe("PR13 — GCF consumes the relationship graph", () => {
  it("projects operating + personal entities, excludes non-cash-flow roles", () => {
    const entities = toGcfEntities(graph);
    const ids = entities.map((e) => e.id);
    assert.ok(ids.includes("opco"));
    assert.ok(ids.includes("owner"));
    assert.ok(!ids.includes("landlord")); // landlord excluded
    assert.equal(entities.find((e) => e.id === "opco")!.side, "operating");
    assert.equal(entities.find((e) => e.id === "owner")!.side, "personal");
  });

  it("rolls up global cash flow + DSCR without double counting", () => {
    const g = rollUpGlobalCashFlow(graph);
    // operating = opco 900k + affiliate 300k + epc 120k = 1,320,000
    assert.equal(g.operatingCashFlow, 1_320_000);
    // personal = owner 150k + spouse 80k = 230,000
    assert.equal(g.personalCashFlow, 230_000);
    assert.equal(g.totalCashFlow, 1_550_000);
    // debt service = 500k + 200k + 100k + 60k = 860,000
    assert.equal(g.totalDebtService, 860_000);
    assert.ok(Math.abs(g.globalDscr! - 1_550_000 / 860_000) < 1e-9);
  });
});
