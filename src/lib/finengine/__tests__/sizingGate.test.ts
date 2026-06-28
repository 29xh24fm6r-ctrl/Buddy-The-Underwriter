/**
 * SPEC-FINENGINE-PRODUCT-DEPTH-AND-SIZING-1 — Workstream F: sizing→pricing gate.
 *
 * Flag-gated promotion of the read-only shadow. OFF (default) = shadow only,
 * never gated (pricing unchanged); ON = an UNEXPECTED over-size is gated. The
 * product sizings A–D all plug into the reconciler via the shared SizingResult.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { resolveSizingGateFlags, evaluateSizingGate, gateSizingVsPricing } from "@/lib/finengine/sizing/sizingGate";
import { reconcileSizingVsPricing } from "@/lib/finengine/sizing/sizingPricingShadow";
import { sizeCre, sizeEquipment, sizeConstruction, sizeCAndI, sizeRevolver } from "@/lib/finengine/sizing";

const cre = { propertyValue: 5_000_000, noi: 400_000, annualConstantRate: 0.07, minDebtYield: 0.09 };

describe("Workstream F — resolveSizingGateFlags", () => {
  it("defaults to {} (every tenant OFF) when the env var is absent", () => {
    assert.deepEqual(resolveSizingGateFlags({}), {});
  });

  it("parses a comma-separated SIZING_GATE_TENANTS allowlist", () => {
    assert.deepEqual(resolveSizingGateFlags({ SIZING_GATE_TENANTS: "bank-a, bank-b" }), { "bank-a": true, "bank-b": true });
  });
});

describe("Workstream F — evaluateSizingGate", () => {
  const oversized = reconcileSizingVsPricing({ pricedLoanAmount: sizeCre(cre).maxLoan! + 500_000, sizing: sizeCre(cre) });

  it("OFF (default) — shadow mode, never gated even on an UNEXPECTED over-size (pricing unchanged)", () => {
    assert.equal(oversized.classification, "UNEXPECTED");
    const d = evaluateSizingGate({ tenantId: "bank-a", shadow: oversized }); // no flags ⇒ OFF
    assert.equal(d.mode, "shadow");
    assert.equal(d.gated, false);
    assert.match(d.note, /shadow only/);
  });

  it("ON — enforce mode gates an UNEXPECTED over-size", () => {
    const d = evaluateSizingGate({ tenantId: "bank-a", shadow: oversized, flags: { "bank-a": true } });
    assert.equal(d.mode, "enforce");
    assert.equal(d.gated, true);
    assert.match(d.note, /GATED/);
  });

  it("ON — a ZERO (within sizing) facility passes", () => {
    const within = reconcileSizingVsPricing({ pricedLoanAmount: sizeCre(cre).maxLoan! - 100_000, sizing: sizeCre(cre) });
    const d = evaluateSizingGate({ tenantId: "bank-a", shadow: within, flags: { "bank-a": true } });
    assert.equal(within.classification, "ZERO");
    assert.equal(d.gated, false);
  });

  it("ON — a registered exception (INTENDED) passes the gate", () => {
    const excused = reconcileSizingVsPricing({ pricedLoanAmount: sizeCre(cre).maxLoan! + 500_000, sizing: sizeCre(cre), intendedReason: "approved exception #42" });
    const d = evaluateSizingGate({ tenantId: "bank-a", shadow: excused, flags: { "bank-a": true } });
    assert.equal(excused.classification, "INTENDED");
    assert.equal(d.gated, false);
  });

  it("a tenant NOT on the allowlist stays OFF even when others are ON", () => {
    const d = evaluateSizingGate({ tenantId: "bank-z", shadow: oversized, flags: { "bank-a": true } });
    assert.equal(d.mode, "shadow");
    assert.equal(d.gated, false);
  });
});

describe("Workstream F — product sizings A–D plug into the gate", () => {
  const ON = { "bank-a": true };
  const cases: Array<{ name: string; sizing: ReturnType<typeof sizeCre>; over: number }> = [
    { name: "equipment", sizing: sizeEquipment({ equipmentCost: 100_000, isNew: true }), over: 120_000 }, // max 80k
    { name: "construction", sizing: sizeConstruction({ totalProjectCost: 10_000_000, asCompletedValue: 11_000_000, interestRate: 0.085, constructionMonths: 18 }), over: 9_000_000 }, // max 8M
    { name: "c&i", sizing: sizeCAndI({ ebitda: 2_000_000, existingFundedDebt: 1_000_000, existingSeniorDebt: 500_000, annualConstantRate: 0.15 }), over: 6_000_000 }, // max 5.5M
    { name: "revolver", sizing: sizeRevolver({ ar: 800_000, inventory: 500_000, ap: 400_000 }), over: 1_200_000 }, // max 900k
  ];

  for (const c of cases) {
    it(`${c.name}: an over-sized priced amount reconciles UNEXPECTED and gates when ON`, () => {
      const d = gateSizingVsPricing({ tenantId: "bank-a", pricedLoanAmount: c.over, sizing: c.sizing, flags: ON });
      assert.equal(d.classification, "UNEXPECTED");
      assert.equal(d.gated, true);
    });

    it(`${c.name}: the same over-size is shadow-only (not gated) when OFF`, () => {
      const d = gateSizingVsPricing({ tenantId: "bank-a", pricedLoanAmount: c.over, sizing: c.sizing }); // OFF
      assert.equal(d.mode, "shadow");
      assert.equal(d.gated, false);
    });
  }
});
