/**
 * Compute Risk Delta Guards
 *
 * Invariants enforced:
 *   1. DSCR up = positive driver, contributes to "improving"
 *   2. DSCR down = negative driver, contributes to "deteriorating"
 *   3. Policy exception count down = positive driver
 *   4. Mixed drivers → neutral, materiality moderate
 *   5. Big swing (≥2 net) → materiality material
 *   6. Pure: same inputs produce identical output
 */

import test from "node:test";
import assert from "node:assert/strict";

import { computeRiskDelta } from "@/lib/creditMemo/intelligence/computeRiskDelta";
import type { IntelligenceSnapshotRow } from "@/lib/creditMemo/intelligence/types";

type MemoLike = Record<string, unknown>;

function snapshotRow(id: string, memoVersion: number, memo: MemoLike): IntelligenceSnapshotRow {
  return {
    id,
    memo_version: memoVersion,
    memo_output_json: memo,
    underwriter_feedback_json: null,
  };
}

function memo(opts: {
  dscr?: number | null;
  globalDscr?: number | null;
  collateralCoverage?: number | null;
  exceptionCount?: number;
}): MemoLike {
  return {
    sections: {
      debt_coverage: {
        title: "Debt Coverage",
        data: {
          financial_analysis: {
            dscr: { value: "dscr" in opts ? opts.dscr : 1.4 },
          },
        },
      },
      global_cash_flow: {
        title: "Global Cash Flow",
        data: {
          global_cash_flow: {
            global_dscr: { value: "globalDscr" in opts ? opts.globalDscr : 1.5 },
          },
        },
      },
      collateral: {
        title: "Collateral",
        data: {
          collateral: {
            collateral_coverage: {
              value: "collateralCoverage" in opts ? opts.collateralCoverage : 1.2,
            },
          },
        },
      },
      policy_exceptions: {
        title: "Policy Exceptions",
        data: {
          exceptions: Array.from({ length: opts.exceptionCount ?? 0 }, (_, i) => ({ id: i })),
        },
      },
    },
  };
}

// ─── DSCR direction ──────────────────────────────────────────────────────

test("[risk-1] DSCR up + global DSCR up + collateral up + fewer exceptions → improving", () => {
  const before = snapshotRow("s1", 1, memo({ dscr: 1.18, globalDscr: 1.3, collateralCoverage: 0.74, exceptionCount: 3 }));
  const after = snapshotRow("s2", 2, memo({ dscr: 1.32, globalDscr: 1.45, collateralCoverage: 0.82, exceptionCount: 1 }));
  const result = computeRiskDelta(before, after);
  assert.equal(result.overall, "improving");
  assert.equal(result.materiality, "material"); // |+4 - 0| >= 2
  assert.match(result.recommendation_shift, /strengthened/i);
});

test("[risk-2] DSCR down + global DSCR down → deteriorating", () => {
  const before = snapshotRow("s1", 1, memo({ dscr: 1.5, globalDscr: 1.6 }));
  const after = snapshotRow("s2", 2, memo({ dscr: 1.2, globalDscr: 1.3 }));
  const result = computeRiskDelta(before, after);
  assert.equal(result.overall, "deteriorating");
  assert.match(result.recommendation_shift, /weakened/i);
});

// ─── Policy exceptions ──────────────────────────────────────────────────

test("[risk-3] policy exception count down → positive driver (higher is NOT better)", () => {
  const before = snapshotRow("s1", 1, memo({ exceptionCount: 5 }));
  const after = snapshotRow("s2", 2, memo({ exceptionCount: 1 }));
  const result = computeRiskDelta(before, after);
  const exceptionsDriver = result.drivers.find((d) => d.factor === "Policy exceptions");
  assert.ok(exceptionsDriver);
  assert.equal(exceptionsDriver!.before, 5);
  assert.equal(exceptionsDriver!.after, 1);
  assert.equal(exceptionsDriver!.direction, "down");
  assert.equal(exceptionsDriver!.impact, "positive");
});

// ─── Mixed drivers ──────────────────────────────────────────────────────

test("[risk-4] mixed drivers (one up, one down) → neutral, moderate", () => {
  const before = snapshotRow("s1", 1, memo({ dscr: 1.4, globalDscr: 1.5 }));
  const after = snapshotRow("s2", 2, memo({ dscr: 1.6, globalDscr: 1.3 }));
  const result = computeRiskDelta(before, after);
  // DSCR up = +1 positive; global DSCR down = +1 negative; net = 0
  assert.equal(result.overall, "neutral");
  assert.equal(result.materiality, "moderate");
});

// ─── Snapshot identity passthrough ──────────────────────────────────────

test("[risk-5] meta carries from/to snapshot ids", () => {
  const before = snapshotRow("s1", 1, memo({}));
  const after = snapshotRow("s2", 2, memo({}));
  const result = computeRiskDelta(before, after);
  assert.equal(result.from_snapshot_id, "s1");
  assert.equal(result.to_snapshot_id, "s2");
});

// ─── Drivers always 4 ───────────────────────────────────────────────────

test("[risk-6] always returns 4 drivers (DSCR, Global DSCR, Collateral, Policy exceptions)", () => {
  const before = snapshotRow("s1", 1, memo({}));
  const after = snapshotRow("s2", 2, memo({}));
  const result = computeRiskDelta(before, after);
  assert.equal(result.drivers.length, 4);
  const factors = result.drivers.map((d) => d.factor).sort();
  assert.deepEqual(factors, ["Collateral coverage", "DSCR", "Global DSCR", "Policy exceptions"]);
});

// ─── Null tolerance ─────────────────────────────────────────────────────

test("[risk-7] missing values → unchanged direction, neutral impact", () => {
  const before = snapshotRow("s1", 1, memo({ dscr: null, globalDscr: null }));
  const after = snapshotRow("s2", 2, memo({ dscr: null, globalDscr: null }));
  const result = computeRiskDelta(before, after);
  // No metrics → all drivers unchanged or transitional → overall neutral
  assert.equal(result.overall, "neutral");
});

// ─── Determinism ────────────────────────────────────────────────────────

test("[risk-8] same inputs produce identical output", () => {
  const before = snapshotRow("s1", 1, memo({ dscr: 1.2 }));
  const after = snapshotRow("s2", 2, memo({ dscr: 1.5 }));
  const a = computeRiskDelta(before, after);
  const b = computeRiskDelta(before, after);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
