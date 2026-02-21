/**
 * Confidence Calibration Guards — Institutional Non-Regression
 *
 * Ensures confidence represents real uncertainty, not tier identity.
 * Pure synchronous tests against calibrateConfidence().
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calibrateConfidence,
  deriveBand,
  CONFIDENCE_FLOOR,
  CONFIDENCE_CEILING,
  BAND_HIGH_THRESHOLD,
  BAND_MEDIUM_THRESHOLD,
  PENALTY_AMBIGUITY,
  PENALTY_MULTI_FORM,
  PENALTY_YEAR_UNCERTAINTY_NONE,
  PENALTY_LOW_TEXT_DENSITY,
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

describe("confidenceCalibrationGuard", () => {
  it("guard-1: clean Tier 1 (no penalties) → confidence ≥ 0.90", () => {
    const result = calibrateConfidence(makeInput());

    assert.equal(result.penalties.length, 0);
    assert.ok(result.confidence >= 0.90, `Expected ≥ 0.90, got ${result.confidence}`);
  });

  it("guard-2: multi-form bundle → drop ≥ 0.10 from base", () => {
    const base = 0.95;
    const result = calibrateConfidence(makeInput({
      baseConfidence: base,
      formNumbers: ["1040", "K-1"],
    }));

    const drop = base - result.confidence;
    assert.ok(drop >= 0.10, `Expected drop ≥ 0.10, got ${drop}`);
    assert.ok(
      result.penalties.some((p) => p.kind === "multi_form"),
      "Expected multi_form penalty",
    );
  });

  it("guard-3: no text + no year → drop ≥ 0.12 from base", () => {
    const base = 0.95;
    const result = calibrateConfidence(makeInput({
      baseConfidence: base,
      textLength: 50,
      taxYear: null,
      detectedYears: [],
    }));

    const drop = base - result.confidence;
    const expectedDrop = PENALTY_LOW_TEXT_DENSITY + PENALTY_YEAR_UNCERTAINTY_NONE;
    assert.ok(
      drop >= 0.12,
      `Expected drop ≥ 0.12 (low_text + year_none = ${expectedDrop}), got ${drop}`,
    );
  });

  it("guard-4: ambiguous Tier 3 with confusion candidates → drop ≥ 0.10", () => {
    const base = 0.85;
    const result = calibrateConfidence(makeInput({
      baseConfidence: base,
      spineTier: "tier3_llm",
      confusionCandidates: ["RENT_ROLL", "INCOME_STATEMENT"],
    }));

    const drop = base - result.confidence;
    assert.ok(drop >= 0.10 - 1e-9, `Expected drop ≥ 0.10, got ${drop}`);
    assert.ok(
      result.penalties.some((p) => p.kind === "ambiguity"),
      "Expected ambiguity penalty",
    );
  });

  it("guard-5: distribution spread across profiles ≥ 0.20", () => {
    const cleanForm = calibrateConfidence(makeInput({
      baseConfidence: 0.97,
    }));

    const multiformBundle = calibrateConfidence(makeInput({
      baseConfidence: 0.92,
      formNumbers: ["1040", "K-1", "1065"],
      confusionCandidates: ["BUSINESS_TAX_RETURN"],
    }));

    const filenameOnly = calibrateConfidence(makeInput({
      baseConfidence: 0.60,
      spineTier: "fallback",
      textLength: 0,
      taxYear: null,
      detectedYears: [],
      formNumbers: null,
    }));

    const ambiguousFs = calibrateConfidence(makeInput({
      baseConfidence: 0.82,
      spineTier: "tier2_structural",
      confusionCandidates: ["RENT_ROLL", "INCOME_STATEMENT"],
      taxYear: null,
      detectedYears: [2022, 2023],
    }));

    const scores = [
      cleanForm.confidence,
      multiformBundle.confidence,
      filenameOnly.confidence,
      ambiguousFs.confidence,
    ].sort((a, b) => a - b);

    const spread = scores[scores.length - 1] - scores[0];
    assert.ok(spread >= 0.20, `Expected spread ≥ 0.20, got ${spread}`);
  });

  it("guard-6: floor — all penalties applied → confidence ≥ 0.35", () => {
    const result = calibrateConfidence(makeInput({
      baseConfidence: 0.50,
      confusionCandidates: ["A", "B"],
      formNumbers: ["1040", "K-1"],
      taxYear: null,
      detectedYears: [],
      textLength: 10,
    }));

    assert.ok(
      result.confidence >= CONFIDENCE_FLOOR,
      `Expected ≥ ${CONFIDENCE_FLOOR}, got ${result.confidence}`,
    );
  });

  it("guard-7: ceiling — perfect signals → confidence ≤ 0.97", () => {
    const result = calibrateConfidence(makeInput({
      baseConfidence: 0.99,
    }));

    assert.ok(
      result.confidence <= CONFIDENCE_CEILING,
      `Expected ≤ ${CONFIDENCE_CEILING}, got ${result.confidence}`,
    );
  });

  it("guard-8: band thresholds — HIGH ≥ 0.88, LOW < 0.75, MEDIUM between", () => {
    assert.equal(deriveBand(0.95), "HIGH");
    assert.equal(deriveBand(0.88), "HIGH");
    assert.equal(deriveBand(0.87), "MEDIUM");
    assert.equal(deriveBand(0.75), "MEDIUM");
    assert.equal(deriveBand(0.74), "LOW");
    assert.equal(deriveBand(0.35), "LOW");

    // Also verify via calibrateConfidence output
    const high = calibrateConfidence(makeInput({ baseConfidence: 0.95 }));
    assert.equal(high.band, "HIGH");

    const low = calibrateConfidence(makeInput({
      baseConfidence: 0.60,
      textLength: 10,
      taxYear: null,
      detectedYears: [],
    }));
    assert.equal(low.band, "LOW");
  });
});
