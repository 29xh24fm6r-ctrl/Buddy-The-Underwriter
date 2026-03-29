/**
 * Phase 56 — Altman Z-Score Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeAltmanZScore } from "./altmanZScore";

describe("computeAltmanZScore", () => {
  it("safe zone for healthy company", () => {
    const result = computeAltmanZScore({
      workingCapital: 500000, totalAssets: 2000000,
      retainedEarnings: 800000, ebit: 400000,
      bookValueEquity: 1200000, totalLiabilities: 800000,
    });
    assert.equal(result.zone, "safe");
    assert.ok(result.score > 2.6);
  });

  it("distress zone for troubled company", () => {
    const result = computeAltmanZScore({
      workingCapital: -100000, totalAssets: 500000,
      retainedEarnings: -50000, ebit: 10000,
      bookValueEquity: 50000, totalLiabilities: 450000,
    });
    assert.equal(result.zone, "distress");
    assert.ok(result.score < 1.1);
  });

  it("grey zone for moderate company", () => {
    const result = computeAltmanZScore({
      workingCapital: 50000, totalAssets: 1000000,
      retainedEarnings: 100000, ebit: 50000,
      bookValueEquity: 300000, totalLiabilities: 700000,
    });
    assert.equal(result.zone, "grey");
    assert.ok(result.score > 1.1 && result.score < 2.6);
  });

  it("handles zero totalAssets", () => {
    const result = computeAltmanZScore({
      workingCapital: 0, totalAssets: 0, retainedEarnings: 0,
      ebit: 0, bookValueEquity: 0, totalLiabilities: 0,
    });
    assert.equal(result.zone, "distress");
  });

  it("deterministic", () => {
    const params = { workingCapital: 300000, totalAssets: 1500000, retainedEarnings: 500000, ebit: 250000, bookValueEquity: 800000, totalLiabilities: 700000 };
    const r1 = computeAltmanZScore(params);
    const r2 = computeAltmanZScore(params);
    assert.equal(r1.score, r2.score);
    assert.equal(r1.zone, r2.zone);
  });
});
