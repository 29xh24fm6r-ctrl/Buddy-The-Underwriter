/**
 * SPEC-SNAPSHOT-V2-GATE-FALLBACK-1 CI Guard
 *
 * getFinancialSnapshotGate must fall back to financial_snapshots (v1) when
 * no financial_snapshots_v2 row exists. The recompute route still writes to
 * v1, so without this fallback the gate permanently blocks every deal at
 * committee stage.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FILE = resolve(__dirname, "../getFinancialSnapshotGate.ts");

test("Guard: getFinancialSnapshotGate falls back to financial_snapshots (v1) when no v2 row exists", () => {
  const src = readFileSync(FILE, "utf8");
  assert.match(
    src,
    /\.from\("financial_snapshots"\)/,
    "Must query financial_snapshots (v1) as a fallback.",
  );
  assert.match(
    src,
    /let snapshotExists = Boolean\(v2Snapshot\);[\s\S]{0,400}?if \(!snapshotExists\)[\s\S]{0,300}?\.from\("financial_snapshots"\)/,
    "v1 query must only fire when v2 is absent (snapshotExists declared with let, fallback in if block).",
  );
});
