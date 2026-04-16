/**
 * Phase 82 — Contradiction Strength Tests
 *
 * Run with:
 *   node --import tsx --test src/lib/research/__tests__/contradictionStrength.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeContradictionStrength,
  computeContradictionStrengthSummary,
} from "../contradictionStrength.js";
import { REQUIRED_CONTRADICTION_CHECKS } from "../completionGate.js";

const COURT_URL = "https://pacer.uscourts.gov/case/12345";
const REG_URL = "https://www.sec.gov/Archives/edgar/data/foo.htm";
const WEAK_URL = "https://www.yelp.com/biz/some-company";

describe("computeContradictionStrength", () => {
  it("returns 'none' when check is not covered", () => {
    assert.equal(computeContradictionStrength(false, [COURT_URL]), "none");
  });

  it("returns 'strong' when covered + court record in pool", () => {
    assert.equal(computeContradictionStrength(true, [COURT_URL]), "strong");
  });

  it("returns 'strong' when covered + regulatory filing in pool", () => {
    assert.equal(computeContradictionStrength(true, [REG_URL]), "strong");
  });

  it("returns 'weak' when covered but only weak sources", () => {
    assert.equal(
      computeContradictionStrength(true, [WEAK_URL, "https://example.com"]),
      "weak",
    );
  });

  it("returns 'weak' when covered with empty source pool", () => {
    assert.equal(computeContradictionStrength(true, []), "weak");
  });
});

describe("computeContradictionStrengthSummary", () => {
  it("all checks 'none' when nothing covered", () => {
    const s = computeContradictionStrengthSummary([], [COURT_URL]);
    assert.equal(s.strongCount, 0);
    assert.equal(s.weakCount, 0);
    assert.equal(s.noneCount, REQUIRED_CONTRADICTION_CHECKS.length);
    assert.equal(s.requiredCount, REQUIRED_CONTRADICTION_CHECKS.length);
    assert.equal(s.strongRatio, 0);
  });

  it("covered checks become 'strong' when primary sources exist", () => {
    const covered = [...REQUIRED_CONTRADICTION_CHECKS];
    const s = computeContradictionStrengthSummary(covered, [COURT_URL, REG_URL]);
    assert.equal(s.strongCount, REQUIRED_CONTRADICTION_CHECKS.length);
    assert.equal(s.weakCount, 0);
    assert.equal(s.noneCount, 0);
    assert.equal(s.strongRatio, 1);
    assert.equal(s.hasPrimarySources, true);
  });

  it("covered checks become 'weak' when no primary sources", () => {
    const covered = [...REQUIRED_CONTRADICTION_CHECKS];
    const s = computeContradictionStrengthSummary(covered, [WEAK_URL]);
    assert.equal(s.strongCount, 0);
    assert.equal(s.weakCount, REQUIRED_CONTRADICTION_CHECKS.length);
    assert.equal(s.noneCount, 0);
    assert.equal(s.hasPrimarySources, false);
  });

  it("mixed: 5 covered out of 8, with primary sources", () => {
    const covered = REQUIRED_CONTRADICTION_CHECKS.slice(0, 5);
    const s = computeContradictionStrengthSummary(covered, [COURT_URL]);
    assert.equal(s.strongCount, 5);
    assert.equal(s.noneCount, 3);
    assert.equal(s.weakCount, 0);
    assert.equal(s.strongRatio, 5 / REQUIRED_CONTRADICTION_CHECKS.length);
  });

  it("gate threshold boundary: strongRatio < 0.7 triggers downgrade intent", () => {
    // 5/8 = 0.625 — below 0.7 threshold
    const covered = REQUIRED_CONTRADICTION_CHECKS.slice(0, 5);
    const s = computeContradictionStrengthSummary(covered, [COURT_URL]);
    assert.ok((s.strongRatio ?? 0) < 0.7);
  });

  it("gate threshold boundary: strongRatio = 0.75 passes", () => {
    // 6/8 = 0.75 — at/above 0.7 threshold
    const covered = REQUIRED_CONTRADICTION_CHECKS.slice(0, 6);
    const s = computeContradictionStrengthSummary(covered, [COURT_URL]);
    assert.ok((s.strongRatio ?? 0) >= 0.7);
  });

  it("perCheck map contains exactly the required keys", () => {
    const s = computeContradictionStrengthSummary([], []);
    const keys = Object.keys(s.perCheck).sort();
    const expected = [...REQUIRED_CONTRADICTION_CHECKS].sort();
    assert.deepEqual(keys, expected);
  });
});
