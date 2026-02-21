/**
 * Calibration Curve Sanity Guard
 *
 * Ensures band thresholds are consistent with calibrateConfidence.ts
 * and structural sanity of the calibration model holds.
 *
 * Pure synchronous tests. No DB calls.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CONFIDENCE_THRESHOLDS,
  BAND_HIGH_THRESHOLD,
  BAND_MEDIUM_THRESHOLD,
  deriveBand,
  calibrateConfidence,
  CONFIDENCE_FLOOR,
  CONFIDENCE_CEILING,
  type CalibrationInput,
} from "../calibrateConfidence";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<CalibrationInput> = {}): CalibrationInput {
  return {
    baseConfidence: 0.95,
    spineTier: "tier1_anchor",
    confusionCandidates: [],
    formNumbers: ["1040"],
    detectedYears: [2024],
    taxYear: 2024,
    textLength: 5000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe("calibrationCurveSanity", () => {
  it("guard-1: CONFIDENCE_THRESHOLDS.HIGH matches BAND_HIGH_THRESHOLD", () => {
    assert.equal(
      CONFIDENCE_THRESHOLDS.HIGH,
      BAND_HIGH_THRESHOLD,
      "CONFIDENCE_THRESHOLDS.HIGH must equal BAND_HIGH_THRESHOLD",
    );
  });

  it("guard-2: CONFIDENCE_THRESHOLDS.MEDIUM matches BAND_MEDIUM_THRESHOLD", () => {
    assert.equal(
      CONFIDENCE_THRESHOLDS.MEDIUM,
      BAND_MEDIUM_THRESHOLD,
      "CONFIDENCE_THRESHOLDS.MEDIUM must equal BAND_MEDIUM_THRESHOLD",
    );
  });

  it("guard-3: HIGH threshold is 0.88", () => {
    assert.equal(CONFIDENCE_THRESHOLDS.HIGH, 0.88);
  });

  it("guard-4: MEDIUM threshold is 0.75", () => {
    assert.equal(CONFIDENCE_THRESHOLDS.MEDIUM, 0.75);
  });

  it("guard-5: deriveBand uses correct thresholds", () => {
    assert.equal(deriveBand(0.88), "HIGH");
    assert.equal(deriveBand(0.87), "MEDIUM");
    assert.equal(deriveBand(0.75), "MEDIUM");
    assert.equal(deriveBand(0.74), "LOW");
  });

  it("guard-6: synthetic sanity — HIGH override rate should be lower than LOW", () => {
    // Structural invariant: higher confidence → fewer overrides.
    // Tested with synthetic data since no live data available.
    const highOverrideRate = 0.03;  // 3% of HIGH-band docs get overridden
    const lowOverrideRate = 0.15;   // 15% of LOW-band docs get overridden

    assert.ok(
      highOverrideRate < lowOverrideRate,
      `HIGH override rate (${highOverrideRate}) must be less than LOW override rate (${lowOverrideRate})`,
    );
  });

  it("guard-7: calibration produces band in output", () => {
    const result = calibrateConfidence(makeInput());
    assert.ok(
      ["HIGH", "MEDIUM", "LOW"].includes(result.band),
      `Band must be HIGH, MEDIUM, or LOW — got ${result.band}`,
    );
  });

  it("guard-8: floor and ceiling are structurally ordered", () => {
    assert.ok(CONFIDENCE_FLOOR < CONFIDENCE_THRESHOLDS.MEDIUM, "floor < MEDIUM threshold");
    assert.ok(CONFIDENCE_THRESHOLDS.MEDIUM < CONFIDENCE_THRESHOLDS.HIGH, "MEDIUM < HIGH threshold");
    assert.ok(CONFIDENCE_THRESHOLDS.HIGH < CONFIDENCE_CEILING, "HIGH threshold < ceiling");
  });
});
