/**
 * Tests for the parity gate evaluation.
 *
 * Verifies threshold classification: PASS / WARN / BLOCK
 * across income_statement, balance_sheet, and derived categories.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateParityGate,
  DEFAULT_PARITY_GATE_CONFIG,
  type ParityGateConfig,
} from "../parity/parityGate";
import type { ParityReport, PeriodComparisonEntry, Diff } from "../parity/parityCompare";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeDiff(spread: number, model: number): Diff {
  const delta = model - spread;
  const denom = Math.max(1, Math.abs(spread));
  return {
    spread,
    model,
    delta,
    pctDelta: delta / denom,
    material: true, // all diffs in tests are material (gate only looks at material diffs)
  };
}

function makeReport(
  periods: PeriodComparisonEntry[],
  dealId = "test-deal",
): ParityReport {
  return {
    dealId,
    generatedAt: new Date().toISOString(),
    periodComparisons: periods,
    summary: {
      totalDifferences: periods.reduce(
        (n, p) => n + Object.keys(p.differences).length,
        0,
      ),
      materiallyDifferent: periods.length > 0,
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("evaluateParityGate", () => {
  it("empty report → PASS", () => {
    const report = makeReport([]);
    const result = evaluateParityGate(report);
    assert.equal(result.verdict, "PASS");
    assert.equal(result.warnings.length, 0);
    assert.equal(result.blocks.length, 0);
  });

  it("small income diff below warn threshold → PASS", () => {
    // revenue diff of $50 (warn threshold is $100)
    const report = makeReport([
      {
        periodId: "test:2024-12-31",
        periodEnd: "2024-12-31",
        differences: { revenue: makeDiff(500_000, 500_050) },
      },
    ]);
    const result = evaluateParityGate(report);
    assert.equal(result.verdict, "PASS");
  });

  it("income diff at warn level → WARN", () => {
    // revenue diff of $500 (above $100 warn, below $10k block)
    const report = makeReport([
      {
        periodId: "test:2024-12-31",
        periodEnd: "2024-12-31",
        differences: { revenue: makeDiff(500_000, 500_500) },
      },
    ]);
    const result = evaluateParityGate(report);
    assert.equal(result.verdict, "WARN");
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].metric, "revenue");
    assert.equal(result.blocks.length, 0);
  });

  it("income diff at block level → BLOCK", () => {
    // revenue diff of $50,000 (above $10k block threshold)
    const report = makeReport([
      {
        periodId: "test:2024-12-31",
        periodEnd: "2024-12-31",
        differences: { revenue: makeDiff(500_000, 550_000) },
      },
    ]);
    const result = evaluateParityGate(report);
    assert.equal(result.verdict, "BLOCK");
    assert.equal(result.blocks.length, 1);
    assert.equal(result.blocks[0].metric, "revenue");
  });

  it("derived metric (leverage) uses different thresholds", () => {
    // leverage diff of 0.20 (above 0.10 warn, below 0.50 block for derived)
    const report = makeReport([
      {
        periodId: "test:2024-12-31",
        periodEnd: "2024-12-31",
        differences: { leverageDebtToEbitda: makeDiff(2.5, 2.7) },
      },
    ]);
    const result = evaluateParityGate(report);
    assert.equal(result.verdict, "WARN");
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0].category, "derived");
  });

  it("derived metric large diff → BLOCK", () => {
    // leverage diff of 1.0 (above 0.50 block for derived)
    const report = makeReport([
      {
        periodId: "test:2024-12-31",
        periodEnd: "2024-12-31",
        differences: { leverageDebtToEbitda: makeDiff(2.0, 3.0) },
      },
    ]);
    const result = evaluateParityGate(report);
    assert.equal(result.verdict, "BLOCK");
    assert.equal(result.blocks.length, 1);
  });

  it("custom config overrides defaults", () => {
    // revenue diff of $500 — with custom warn at $1000, should be PASS
    const config: ParityGateConfig = {
      income_statement: {
        warnAbsDelta: 1000,
        warnPctDelta: 0.05,
        blockAbsDelta: 50_000,
        blockPctDelta: 0.20,
      },
      balance_sheet: DEFAULT_PARITY_GATE_CONFIG.balance_sheet,
      derived: DEFAULT_PARITY_GATE_CONFIG.derived,
    };

    const report = makeReport([
      {
        periodId: "test:2024-12-31",
        periodEnd: "2024-12-31",
        differences: { revenue: makeDiff(500_000, 500_500) },
      },
    ]);
    const result = evaluateParityGate(report, config);
    assert.equal(result.verdict, "PASS");
  });

  it("multiple periods accumulate correctly", () => {
    const report = makeReport([
      {
        periodId: "test:2023-12-31",
        periodEnd: "2023-12-31",
        differences: { revenue: makeDiff(400_000, 400_200) }, // $200 → WARN
      },
      {
        periodId: "test:2024-12-31",
        periodEnd: "2024-12-31",
        differences: { totalAssets: makeDiff(1_000_000, 1_050_000) }, // $50k → BLOCK
      },
    ]);
    const result = evaluateParityGate(report);
    assert.equal(result.verdict, "BLOCK");
    assert.equal(result.warnings.length, 1); // revenue
    assert.equal(result.blocks.length, 1);   // totalAssets
  });

  it("both warnings and blocks present → BLOCK wins", () => {
    const report = makeReport([
      {
        periodId: "test:2024-12-31",
        periodEnd: "2024-12-31",
        differences: {
          revenue: makeDiff(500_000, 500_500),     // $500 → WARN
          totalAssets: makeDiff(1_000_000, 1_100_000), // $100k → BLOCK
        },
      },
    ]);
    const result = evaluateParityGate(report);
    assert.equal(result.verdict, "BLOCK");
    assert.ok(result.warnings.length >= 1);
    assert.ok(result.blocks.length >= 1);
  });

  it("non-material diffs are ignored", () => {
    const nonMaterialDiff: Diff = {
      spread: 500_000,
      model: 550_000,
      delta: 50_000,
      pctDelta: 0.10,
      material: false, // not material → gate should skip
    };
    const report = makeReport([
      {
        periodId: "test:2024-12-31",
        periodEnd: "2024-12-31",
        differences: { revenue: nonMaterialDiff },
      },
    ]);
    const result = evaluateParityGate(report);
    assert.equal(result.verdict, "PASS");
  });
});
