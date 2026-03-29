/**
 * Phase 53 — Plausibility Checks Tests
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runPlausibilityChecks } from "./plausibilityChecks";

describe("runPlausibilityChecks", () => {
  it("passes DSCR in normal range", () => {
    const checks = runPlausibilityChecks({ DSCR: 1.25 });
    assert.equal(checks[0].status, "PASS");
  });

  it("flags DSCR outside range", () => {
    const checks = runPlausibilityChecks({ DSCR: 15.0 });
    assert.equal(checks[0].status, "FLAG");
  });

  it("flags negative occupancy", () => {
    const checks = runPlausibilityChecks({ OCCUPANCY_PCT: -0.1 });
    const occCheck = checks.find((c) => c.name.includes("Occupancy"));
    assert.ok(occCheck);
    assert.equal(occCheck.status, "FLAG");
  });

  it("passes normal LTV", () => {
    const checks = runPlausibilityChecks({ LTV_GROSS: 0.75 });
    const ltvCheck = checks.find((c) => c.name.includes("LTV"));
    assert.ok(ltvCheck);
    assert.equal(ltvCheck.status, "PASS");
  });
});
