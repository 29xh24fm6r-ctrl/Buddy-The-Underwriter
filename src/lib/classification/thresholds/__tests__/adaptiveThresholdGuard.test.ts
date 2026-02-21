/**
 * Adaptive Auto-Attach Threshold Guards — CI-Blocking Invariants
 *
 * Pure synchronous tests. No DB, no server-only.
 * Guards structural invariants of the adaptive threshold system.
 *
 * Run: node --import tsx --test src/lib/classification/thresholds/__tests__/adaptiveThresholdGuard.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  BASELINE_THRESHOLDS,
  DEFAULT_ADAPTIVE_POLICY,
  ADAPTIVE_THRESHOLD_VERSION,
  type SpineTierKey,
  type CalibrationCurve,
} from "../autoAttachThresholds";
import { resolveAutoAttachThreshold } from "../resolveAutoAttachThreshold";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ALL_TIERS: SpineTierKey[] = [
  "tier1_anchor",
  "tier2_structural",
  "tier3_llm",
  "fallback",
];
const ALL_BANDS = ["HIGH", "MEDIUM", "LOW"] as const;

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe("adaptiveThresholdGuard", () => {
  // ── Guard 1: Version stamp ──────────────────────────────────────────
  it("guard-1: ADAPTIVE_THRESHOLD_VERSION is 'adaptive_v1'", () => {
    assert.equal(ADAPTIVE_THRESHOLD_VERSION, "adaptive_v1");
  });

  // ── Guard 2: Baseline map completeness ─────────────────────────────
  it("guard-2: baseline map has all 12 cells with valid values", () => {
    for (const tier of ALL_TIERS) {
      for (const band of ALL_BANDS) {
        const val = BASELINE_THRESHOLDS[tier]?.[band];
        assert.ok(
          typeof val === "number" && val >= 0.85 && val <= 0.99,
          `Missing or invalid baseline for ${tier}:${band} = ${val}`,
        );
      }
    }
  });

  // ── Guard 3: Fallback tier all 0.99 ────────────────────────────────
  it("guard-3: fallback tier baseline is 0.99 for all bands", () => {
    for (const band of ALL_BANDS) {
      assert.equal(
        BASELINE_THRESHOLDS.fallback[band],
        0.99,
        `fallback:${band} must be 0.99`,
      );
    }
  });

  // ── Guard 4: LOW band all 0.99 ─────────────────────────────────────
  it("guard-4: LOW band baseline is 0.99 for all tiers", () => {
    for (const tier of ALL_TIERS) {
      assert.equal(
        BASELINE_THRESHOLDS[tier].LOW,
        0.99,
        `${tier}:LOW must be 0.99`,
      );
    }
  });

  // ── Guard 5: Policy bounds ─────────────────────────────────────────
  it("guard-5: policy floor=0.85, ceiling=0.99", () => {
    assert.equal(DEFAULT_ADAPTIVE_POLICY.floor, 0.85);
    assert.equal(DEFAULT_ADAPTIVE_POLICY.ceiling, 0.99);
  });

  // ── Guard 6: minSamples ────────────────────────────────────────────
  it("guard-6: minSamples is 50", () => {
    assert.equal(DEFAULT_ADAPTIVE_POLICY.minSamples, 50);
  });

  // ── Guard 7: Empty calibration → baseline ──────────────────────────
  it("guard-7: empty calibration curve returns baseline for all 12 cells", () => {
    for (const tier of ALL_TIERS) {
      for (const band of ALL_BANDS) {
        const result = resolveAutoAttachThreshold(tier, band, []);
        assert.equal(
          result.threshold,
          BASELINE_THRESHOLDS[tier][band],
          `${tier}:${band} with empty data must return baseline`,
        );
        assert.equal(result.adapted, false);
      }
    }
  });

  // ── Guard 8: Insufficient samples → baseline ──────────────────────
  it("guard-8: insufficient samples (< 50) returns baseline", () => {
    const curve: CalibrationCurve = [
      { tier: "tier1_anchor", band: "HIGH", total: 49, overrides: 0, overrideRate: 0 },
    ];
    const result = resolveAutoAttachThreshold("tier1_anchor", "HIGH", curve);
    assert.equal(result.threshold, BASELINE_THRESHOLDS.tier1_anchor.HIGH);
    assert.equal(result.adapted, false);
  });

  // ── Guard 9: Good data → adaptation ────────────────────────────────
  it("guard-9: sufficient samples + low override rate → adapted threshold < baseline", () => {
    const curve: CalibrationCurve = [
      { tier: "tier1_anchor", band: "HIGH", total: 100, overrides: 2, overrideRate: 0.02 },
    ];
    const result = resolveAutoAttachThreshold("tier1_anchor", "HIGH", curve);
    assert.ok(result.adapted, "Expected adapted=true");
    assert.ok(
      result.threshold < BASELINE_THRESHOLDS.tier1_anchor.HIGH,
      `Threshold ${result.threshold} should be lower than baseline ${BASELINE_THRESHOLDS.tier1_anchor.HIGH}`,
    );
    assert.ok(
      result.threshold >= DEFAULT_ADAPTIVE_POLICY.floor,
      `Threshold ${result.threshold} must not go below floor ${DEFAULT_ADAPTIVE_POLICY.floor}`,
    );
  });

  // ── Guard 10: High override rate → no adaptation ───────────────────
  it("guard-10: high override rate (>0.05) → no adaptation", () => {
    const curve: CalibrationCurve = [
      { tier: "tier1_anchor", band: "HIGH", total: 100, overrides: 10, overrideRate: 0.10 },
    ];
    const result = resolveAutoAttachThreshold("tier1_anchor", "HIGH", curve);
    assert.equal(result.adapted, false);
    assert.equal(result.threshold, BASELINE_THRESHOLDS.tier1_anchor.HIGH);
  });

  // ── Guard 11: Fallback tier NEVER adapts ───────────────────────────
  it("guard-11: fallback tier never adapts even with perfect data", () => {
    const curve: CalibrationCurve = [
      { tier: "fallback", band: "HIGH", total: 1000, overrides: 0, overrideRate: 0 },
    ];
    const result = resolveAutoAttachThreshold("fallback", "HIGH", curve);
    assert.equal(result.adapted, false);
    assert.equal(result.threshold, 0.99);
  });

  // ── Guard 12: LOW band NEVER loosens ───────────────────────────────
  it("guard-12: LOW band never loosens for any tier", () => {
    for (const tier of ALL_TIERS) {
      const curve: CalibrationCurve = [
        { tier, band: "LOW", total: 1000, overrides: 0, overrideRate: 0 },
      ];
      const result = resolveAutoAttachThreshold(tier, "LOW", curve);
      assert.equal(result.adapted, false, `LOW band should not adapt for ${tier}`);
      assert.equal(result.threshold, 0.99);
    }
  });

  // ── Guard 13: Floor clamp ──────────────────────────────────────────
  it("guard-13: threshold never goes below floor even with aggressive policy", () => {
    const aggressivePolicy = {
      ...DEFAULT_ADAPTIVE_POLICY,
      loosenStep: 0.50,
      maxLoosen: 0.50,
    };
    const curve: CalibrationCurve = [
      { tier: "tier1_anchor", band: "HIGH", total: 100, overrides: 0, overrideRate: 0 },
    ];
    const result = resolveAutoAttachThreshold(
      "tier1_anchor",
      "HIGH",
      curve,
      aggressivePolicy,
    );
    assert.ok(
      result.threshold >= 0.85,
      `Threshold ${result.threshold} must not go below floor 0.85`,
    );
  });

  // ── Guard 14: autoAttachThresholds.ts is pure ──────────────────────
  it("guard-14: autoAttachThresholds.ts has no server-only import", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/classification/thresholds/autoAttachThresholds.ts"),
      "utf8",
    );
    assert.ok(!(/import\s+["']server-only["']/.test(src)), "Must not import server-only");
    assert.ok(!(/[^/]\bDate\.now\b/.test(src)), "Must not use Date.now");
    assert.ok(!(/[^/]\bMath\.random\b/.test(src)), "Must not use Math.random");
  });

  // ── Guard 15: resolveAutoAttachThreshold.ts is pure ────────────────
  it("guard-15: resolveAutoAttachThreshold.ts has no server-only import", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/lib/classification/thresholds/resolveAutoAttachThreshold.ts"),
      "utf8",
    );
    assert.ok(!(/import\s+["']server-only["']/.test(src)), "Must not import server-only");
    assert.ok(!(/[^/]\bDate\.now\b/.test(src)), "Must not use Date.now");
    assert.ok(!(/[^/]\bMath\.random\b/.test(src)), "Must not use Math.random");
  });

  // ── Guard 16: Monotonicity ─────────────────────────────────────────
  it("guard-16: baseline thresholds are monotonically non-decreasing from tier1 to tier3", () => {
    for (const band of ALL_BANDS) {
      assert.ok(
        BASELINE_THRESHOLDS.tier1_anchor[band] <= BASELINE_THRESHOLDS.tier2_structural[band],
        `tier1 ${band} (${BASELINE_THRESHOLDS.tier1_anchor[band]}) must be <= tier2 (${BASELINE_THRESHOLDS.tier2_structural[band]})`,
      );
      assert.ok(
        BASELINE_THRESHOLDS.tier2_structural[band] <= BASELINE_THRESHOLDS.tier3_llm[band],
        `tier2 ${band} (${BASELINE_THRESHOLDS.tier2_structural[band]}) must be <= tier3 (${BASELINE_THRESHOLDS.tier3_llm[band]})`,
      );
      assert.ok(
        BASELINE_THRESHOLDS.tier3_llm[band] <= BASELINE_THRESHOLDS.fallback[band],
        `tier3 ${band} (${BASELINE_THRESHOLDS.tier3_llm[band]}) must be <= fallback (${BASELINE_THRESHOLDS.fallback[band]})`,
      );
    }
  });
});
