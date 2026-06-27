import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  dscr,
  proposedLoanCoverage,
  globalDscr,
  fccr,
  leverageTotal,
  leverageCashNetted,
  debtYield,
  ltv,
  quickRatio,
} from "@/lib/finengine/metrics";

describe("DSCR family — global denominator (V4.1)", () => {
  it("DSCR uses GLOBAL debt service, not proposed-loan-only", () => {
    const r = dscr(390_000, 300_000, { productId: "SBA_7A_STANDARD" });
    assert.equal(r.value, 1.3);
    assert.equal(r.inputs.globalDebtService, 300_000);
    // SBA Standard floor 1.15; 1.30 passes
    assert.equal(r.passesFloor, true);
    assert.equal(r.policyApplied?.axis, "dscr_floor");
  });

  it("proposed-loan coverage is a SEPARATE metric, explicitly not DSCR", () => {
    const r = proposedLoanCoverage(390_000, 150_000);
    assert.equal(r.metric, "PROPOSED_LOAN_COVERAGE");
    assert.equal(r.value, 2.6);
  });

  it("fails the floor when DSCR below the SBA standard 1.15", () => {
    const r = dscr(110_000, 100_000, { productId: "SBA_7A_STANDARD" });
    assert.equal(r.value, 1.1);
    assert.equal(r.passesFloor, false);
  });

  it("global DSCR resolves against the registry floor", () => {
    const r = globalDscr(700_000, 390_000);
    assert.ok(r.value && r.value > 1.7);
    assert.equal(r.policyApplied?.axis, "dscr_floor");
  });
});

describe("FCCR nets the right charges", () => {
  it("subtracts capex/taxes/distributions and includes rent both sides", () => {
    const r = fccr({ cashAvailable: 500_000, rent: 100_000, capex: 50_000, cashTaxes: 40_000, distributions: 30_000, fixedCharges: 250_000 });
    // (500k + 100k − 50k − 40k − 30k) / 250k = 480k/250k = 1.92
    assert.equal(r.value, 1.92);
  });
});

describe("leverage variants", () => {
  it("total vs cash-netted differ by the cash offset", () => {
    const gross = leverageTotal(4_000_000, 1_000_000);
    const net = leverageCashNetted(4_000_000, 500_000, 1_000_000);
    assert.equal(gross.value, 4);
    assert.equal(net.value, 3.5);
  });
  it("leverage is a cap — passesFloor true when under the limit", () => {
    const r = leverageTotal(4_000_000, 1_000_000, { productId: "CI_TERM" });
    assert.equal(r.policyApplied?.direction, "cap");
    assert.equal(r.passesFloor, true); // 4.0x <= 4.5x
  });
});

describe("CRE / liquidity ratios", () => {
  it("debt yield = NOI / loan", () => {
    assert.equal(debtYield(300_000, 3_000_000).value, 0.1);
  });
  it("LTV cap resolves from registry", () => {
    const r = ltv(750_000, 1_000_000);
    assert.equal(r.value, 0.75);
    assert.equal(r.passesFloor, true); // 0.75 <= 0.75 cap
  });
  it("quick ratio excludes inventory", () => {
    assert.equal(quickRatio(500_000, 200_000, 300_000).value, 1);
  });
});
