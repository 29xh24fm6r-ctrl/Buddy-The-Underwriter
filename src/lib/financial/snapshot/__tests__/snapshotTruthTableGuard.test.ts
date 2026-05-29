/**
 * SPEC-SNAPSHOT-TRUTH-TABLE-FIX-1 CI Guard
 *
 * deal_truth_snapshots was a legacy table reference that never existed in DB.
 * PostgREST returned 404 on every call, causing the financial snapshot
 * recompute endpoint to 500 at underwrite_in_progress/committee_ready.
 *
 * getFinancialSnapshotGate must not query it. snapshotExists is seeded from
 * financial_snapshots_v2; a documented fallback to the real v1
 * financial_snapshots table is permitted (the recompute route still writes
 * v1) so the committee gate does not permanently block every deal — that
 * fallback does NOT reintroduce the phantom deal_truth_snapshots query.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(__dirname, "../getFinancialSnapshotGate.ts");

test("Guard: getFinancialSnapshotGate does not query deal_truth_snapshots", () => {
  const src = readFileSync(FILE, "utf8");
  assert.doesNotMatch(
    src,
    /deal_truth_snapshots/,
    "Legacy deal_truth_snapshots query was removed in SPEC-SNAPSHOT-TRUTH-TABLE-FIX-1 — do not re-introduce.",
  );
  assert.doesNotMatch(
    src,
    /legacyCount/,
    "legacyCount variable was removed alongside the legacy query.",
  );
  assert.match(
    src,
    /snapshotExists = Boolean\(v2Snapshot\)/,
    "snapshotExists must be seeded from financial_snapshots_v2 (a documented v1 financial_snapshots fallback is allowed).",
  );
  // The only permitted fallback table is the real v1 `financial_snapshots`.
  // Anything else (especially the phantom deal_truth_snapshots) is barred by
  // the doesNotMatch assertions above.
  assert.match(
    src,
    /\.from\("financial_snapshots"\)/,
    "v1 fallback must read the real financial_snapshots table.",
  );
});
