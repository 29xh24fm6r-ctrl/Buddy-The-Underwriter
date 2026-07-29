/**
 * SPEC-M3 GLASS-BOX-1 — loadLatestSnapshotMetrics unit tests.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { loadLatestSnapshotMetrics } = require("../snapshotService") as typeof import("../snapshotService");

function fakeClient(row: Record<string, unknown> | null) {
  return {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: row, error: null });
        },
      };
    },
  };
}

test("returns null when no snapshot row exists", async () => {
  const result = await loadLatestSnapshotMetrics(fakeClient(null), "deal-1");
  assert.equal(result, null);
});

test("maps computed_metrics and risk_flags from the row", async () => {
  const row = {
    computed_metrics: { DSCR: 1.35, EBITDA: 250000 },
    risk_flags: [{ key: "DSCR", value: 1.35, threshold: 1.25, severity: "low" }],
    calculated_at: "2026-07-01T00:00:00.000Z",
  };
  const result = await loadLatestSnapshotMetrics(fakeClient(row), "deal-2");
  assert.deepEqual(result, {
    computedMetrics: { DSCR: 1.35, EBITDA: 250000 },
    riskFlags: [{ key: "DSCR", value: 1.35, threshold: 1.25, severity: "low" }],
    calculatedAt: "2026-07-01T00:00:00.000Z",
  });
});

test("defaults computed_metrics/risk_flags to empty when null on the row", async () => {
  const row = { computed_metrics: null, risk_flags: null, calculated_at: "2026-07-01T00:00:00.000Z" };
  const result = await loadLatestSnapshotMetrics(fakeClient(row), "deal-3");
  assert.deepEqual(result?.computedMetrics, {});
  assert.deepEqual(result?.riskFlags, []);
});

test("returns null when the query errors", async () => {
  const client = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: { message: "boom" } });
        },
      };
    },
  };
  const result = await loadLatestSnapshotMetrics(client, "deal-4");
  assert.equal(result, null);
});
