import test from "node:test";
import assert from "node:assert/strict";
import { ratioToPercentString } from "../snapshotFormat";

// Snapshot ratio metrics are 0–1. The deal header rendered LTV 0.80 as "1%"
// because it formatted the ratio as though it were already a percentage.

test("ratioToPercentString: 0.80 LTV renders as 80%", () => {
  assert.equal(ratioToPercentString(0.8), "80%");
  assert.equal(ratioToPercentString(1), "100%");
  assert.equal(ratioToPercentString(0.2), "20%");
});

test("ratioToPercentString: honors digits and rounds", () => {
  assert.equal(ratioToPercentString(0.8, 1), "80.0%");
  assert.equal(ratioToPercentString(0.9567, 1), "95.7%");
  assert.equal(ratioToPercentString(0.005), "1%");
});

test("ratioToPercentString: null / non-finite renders as em dash", () => {
  assert.equal(ratioToPercentString(null), "—");
  assert.equal(ratioToPercentString(undefined), "—");
  assert.equal(ratioToPercentString(Number.NaN), "—");
  assert.equal(ratioToPercentString(Number.POSITIVE_INFINITY), "—");
});
