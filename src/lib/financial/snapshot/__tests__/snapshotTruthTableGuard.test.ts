/**
 * SPEC-SNAPSHOT-TRUTH-TABLE-FIX-1 CI Guard
 *
 * deal_truth_snapshots was a legacy table reference that never existed in DB.
 * PostgREST returned 404 on every call, causing the financial snapshot
 * recompute endpoint to 500 at underwrite_in_progress/committee_ready.
 *
 * getFinancialSnapshotGate must not query it. snapshotExists must derive
 * solely from financial_snapshots_v2.
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
    /const snapshotExists = Boolean\(v2Snapshot\);/,
    "snapshotExists must derive solely from financial_snapshots_v2.",
  );
});
