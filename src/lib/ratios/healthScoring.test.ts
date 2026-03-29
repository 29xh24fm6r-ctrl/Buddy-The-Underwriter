/**
 * Phase 56 — Health Scoring Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeHealthScore } from "./healthScoring";

describe("computeHealthScore", () => {
  it("produces 0-100 composite", () => {
    const score = computeHealthScore({
      grossMargin: 0.35, netMargin: 0.10, roa: 0.08,
      currentRatio: 1.8, debtToEquity: 2.0, dscr: 1.35,
    });
    assert.ok(score.composite >= 0 && score.composite <= 100);
  });

  it("each component is 0-25", () => {
    const score = computeHealthScore({
      grossMargin: 0.35, netMargin: 0.10, roa: 0.08,
      currentRatio: 1.8, debtToEquity: 2.0, dscr: 1.35,
    });
    assert.ok(score.profitability >= 0 && score.profitability <= 25);
    assert.ok(score.liquidity >= 0 && score.liquidity <= 25);
    assert.ok(score.leverage >= 0 && score.leverage <= 25);
    assert.ok(score.efficiency >= 0 && score.efficiency <= 25);
  });

  it("strong company scores higher than weak", () => {
    const strong = computeHealthScore({
      grossMargin: 0.50, netMargin: 0.20, roa: 0.15,
      currentRatio: 2.5, debtToEquity: 0.5, dscr: 2.0,
    });
    const weak = computeHealthScore({
      grossMargin: 0.10, netMargin: 0.01, roa: 0.01,
      currentRatio: 0.5, debtToEquity: 5.0, dscr: 0.9,
    });
    assert.ok(strong.composite > weak.composite);
  });

  it("produces letter grades", () => {
    const score = computeHealthScore({ grossMargin: 0.35 });
    assert.ok(["A", "B", "C", "D", "F"].includes(score.grades.overall));
  });

  it("deterministic", () => {
    const input = { grossMargin: 0.35, netMargin: 0.10, currentRatio: 1.5, dscr: 1.25 };
    const s1 = computeHealthScore(input);
    const s2 = computeHealthScore(input);
    assert.equal(s1.composite, s2.composite);
  });
});
