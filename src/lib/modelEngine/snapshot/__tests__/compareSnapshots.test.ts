/**
 * Phase 13 — Snapshot Comparison Tests
 *
 * Validates compareSnapshotMetrics:
 * - Unchanged within tolerance
 * - Changed outside tolerance
 * - Added/removed metrics
 * - Max delta tracking
 * - Never mutates inputs
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareSnapshotMetrics } from "../compareSnapshots";

describe("Phase 13 — compareSnapshotMetrics", () => {
  it("marks identical values as unchanged", () => {
    const before = { REVENUE: 1000000, DSCR: 1.25 };
    const after = { REVENUE: 1000000, DSCR: 1.25 };

    const result = compareSnapshotMetrics(before, after);

    assert.equal(result.summary.unchanged, 2);
    assert.equal(result.summary.changed, 0);
    assert.equal(result.summary.added, 0);
    assert.equal(result.summary.removed, 0);
  });

  it("marks values within tolerance as unchanged", () => {
    const before = { REVENUE: 1000000 };
    const after = { REVENUE: 1000000.005 };

    const result = compareSnapshotMetrics(before, after);

    assert.equal(result.summary.unchanged, 1);
    assert.equal(result.summary.changed, 0);
  });

  it("marks values outside tolerance as changed", () => {
    const before = { REVENUE: 1000000 };
    const after = { REVENUE: 1100000 };

    const result = compareSnapshotMetrics(before, after);

    assert.equal(result.summary.changed, 1);
    const delta = result.deltas.find(d => d.key === "REVENUE");
    assert.ok(delta);
    assert.equal(delta.status, "changed");
    assert.equal(delta.delta, 100000);
    assert.ok(delta.deltaPercent !== null && Math.abs(delta.deltaPercent - 0.1) < 0.0001);
  });

  it("detects added metrics", () => {
    const before = { REVENUE: 1000000 };
    const after = { REVENUE: 1000000, DSCR: 1.25 };

    const result = compareSnapshotMetrics(before, after);

    assert.equal(result.summary.added, 1);
    const delta = result.deltas.find(d => d.key === "DSCR");
    assert.ok(delta);
    assert.equal(delta.status, "added");
  });

  it("detects removed metrics", () => {
    const before = { REVENUE: 1000000, DSCR: 1.25 };
    const after = { REVENUE: 1000000 };

    const result = compareSnapshotMetrics(before, after);

    assert.equal(result.summary.removed, 1);
    const delta = result.deltas.find(d => d.key === "DSCR");
    assert.ok(delta);
    assert.equal(delta.status, "removed");
  });

  it("tracks maxAbsoluteDelta and maxPercentDelta", () => {
    const before = { A: 100, B: 1000 };
    const after = { A: 200, B: 1500 };

    const result = compareSnapshotMetrics(before, after);

    assert.equal(result.summary.maxAbsoluteDelta, 500); // B changed by 500
    assert.ok(result.summary.maxPercentDelta !== null);
    // A changed by 100% (1.0), B changed by 50% (0.5) → maxPercent = 1.0
    assert.ok(Math.abs(result.summary.maxPercentDelta! - 1.0) < 0.0001);
  });

  it("handles null values correctly", () => {
    const before: Record<string, number | null> = { A: null, B: 100 };
    const after: Record<string, number | null> = { A: null, B: null };

    const result = compareSnapshotMetrics(before, after);

    const deltaA = result.deltas.find(d => d.key === "A");
    assert.ok(deltaA);
    assert.equal(deltaA.status, "unchanged"); // null === null

    const deltaB = result.deltas.find(d => d.key === "B");
    assert.ok(deltaB);
    assert.equal(deltaB.status, "changed"); // 100 → null
  });

  it("never mutates inputs", () => {
    const before = { REVENUE: 1000000 };
    const after = { REVENUE: 1100000, DSCR: 1.25 };

    const beforeCopy = { ...before };
    const afterCopy = { ...after };

    compareSnapshotMetrics(before, after);

    assert.deepStrictEqual(before, beforeCopy);
    assert.deepStrictEqual(after, afterCopy);
  });

  it("respects custom thresholds", () => {
    const before = { A: 100 };
    const after = { A: 110 }; // 10% change

    // With high tolerance → unchanged
    const result1 = compareSnapshotMetrics(before, after, {
      absoluteTolerance: 20,
      percentTolerance: 0.2,
    });
    assert.equal(result1.summary.unchanged, 1);

    // With default tolerance → changed
    const result2 = compareSnapshotMetrics(before, after);
    assert.equal(result2.summary.changed, 1);
  });

  it("returns correct totalMetrics count", () => {
    const before = { A: 1, B: 2 };
    const after = { B: 2, C: 3 };

    const result = compareSnapshotMetrics(before, after);

    assert.equal(result.summary.totalMetrics, 3); // A, B, C
  });
});
