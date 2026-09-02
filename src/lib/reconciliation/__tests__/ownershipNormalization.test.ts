import test from "node:test";
import assert from "node:assert/strict";

import { checkOwnershipIntegrity, normalizeOwnershipFraction } from "../ownershipIntegrityCheck";

// K1_OWNERSHIP_PCT is extracted on the percent scale ("percentage 100.000000 %"
// → 100). Feeding it into fraction math produced "Ownership exceeds 100%
// (10000.0%)" HARD failures on every sole-owner S-corp.

test("normalizeOwnershipFraction: percent scale → fraction", () => {
  assert.equal(normalizeOwnershipFraction(100), 1);
  assert.equal(normalizeOwnershipFraction(50), 0.5);
  assert.equal(normalizeOwnershipFraction(33.333), 0.33333);
});

test("normalizeOwnershipFraction: fractions pass through, null/negative → null", () => {
  assert.equal(normalizeOwnershipFraction(1), 1);
  assert.equal(normalizeOwnershipFraction(0.25), 0.25);
  assert.equal(normalizeOwnershipFraction(null), null);
  assert.equal(normalizeOwnershipFraction(-5), null);
  assert.equal(normalizeOwnershipFraction(Number.NaN), null);
});

test("checkOwnershipIntegrity: a sole owner at 100 (percent scale) PASSES", () => {
  const r = checkOwnershipIntegrity({ k1Allocations: [{ partnerName: "Owner", ownershipPct: 100 }] });
  assert.equal(r.status, "PASSED");
  assert.equal(r.lhsValue, 1);
});

test("checkOwnershipIntegrity: two partners at 60 + 40 (percent scale) PASSES", () => {
  const r = checkOwnershipIntegrity({
    k1Allocations: [
      { partnerName: "A", ownershipPct: 60 },
      { partnerName: "B", ownershipPct: 40 },
    ],
  });
  assert.equal(r.status, "PASSED");
});

test("checkOwnershipIntegrity: genuinely impossible ownership still FAILS", () => {
  const r = checkOwnershipIntegrity({
    k1Allocations: [
      { partnerName: "A", ownershipPct: 80 },
      { partnerName: "B", ownershipPct: 60 },
    ],
  });
  assert.equal(r.status, "FAILED");
  assert.equal(r.severity, "HARD");
});
