/**
 * Phase 56 — Efficiency Ratios Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDSO, computeDIO, computeDPO, computeCCC, computeAssetTurnover } from "./efficiencyRatios";

describe("efficiencyRatios", () => {
  it("DSO: (AR / Revenue) * 365", () => {
    assert.equal(Math.round(computeDSO(100000, 1000000)), 37); // 36.5 days
  });

  it("DIO: (Inventory / COGS) * 365", () => {
    assert.equal(Math.round(computeDIO(50000, 600000)), 30); // 30.4 days
  });

  it("DPO: (AP / COGS) * 365", () => {
    assert.equal(Math.round(computeDPO(40000, 600000)), 24); // 24.3 days
  });

  it("CCC = DSO + DIO - DPO", () => {
    assert.equal(computeCCC(37, 30, 24), 43);
  });

  it("Asset Turnover = Revenue / Avg Total Assets", () => {
    const at = computeAssetTurnover(2000000, 1500000);
    assert.ok(Math.abs(at - 1.333) < 0.01);
  });

  it("handles zero denominators safely", () => {
    assert.equal(computeDSO(100000, 0), 0);
    assert.equal(computeDIO(50000, 0), 0);
    assert.equal(computeAssetTurnover(1000000, 0), 0);
  });

  it("deterministic: same input always same output", () => {
    const r1 = computeDSO(100000, 1000000);
    const r2 = computeDSO(100000, 1000000);
    assert.equal(r1, r2);
  });
});
