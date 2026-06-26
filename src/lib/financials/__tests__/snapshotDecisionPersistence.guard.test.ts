/**
 * SPEC-FINANCIAL-ANALYSIS-CANONICAL-ENGINE-AND-ADS-MATERIALIZATION-1
 *
 * The financial snapshot row and its decision row are ONE reviewable package.
 * If persistFinancialSnapshot succeeds but persistFinancialSnapshotDecision
 * fails, the orphan snapshot must be rolled back and the failure surfaced
 * explicitly (retry-safe) — never left to make the UI think no package exists
 * and never silently "succeed".
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

const BUILD = read("src/lib/financials/buildFinancialSnapshot.ts");
const RECOMPUTE = read("src/app/api/deals/[dealId]/financial-snapshot/recompute/route.ts");

test("[persist-1] buildFinancialSnapshot wraps the decision write and rolls back the orphan", () => {
  // The decision write must be inside a try/catch.
  assert.match(BUILD, /try\s*\{[\s\S]*persistFinancialSnapshotDecision/);
  // On failure it deletes the orphan snapshot row.
  assert.match(BUILD, /from\("financial_snapshots"\)\.delete\(\)\.eq\("id",\s*snapRow\.id\)/);
  // And surfaces an explicit, non-fake error.
  assert.match(BUILD, /snapshot_decision_persist_failed/);
});

test("[persist-2] buildFinancialSnapshot does NOT return success when the decision write fails", () => {
  // The catch must throw, not fall through to `return { status: "created" }`.
  const idx = BUILD.indexOf("snapshot_decision_persist_failed");
  assert.ok(idx > 0);
  const ctx = BUILD.slice(idx - 200, idx + 100);
  assert.match(ctx, /throw new Error/);
});

test("[persist-3] recompute route rolls back orphan snapshot + returns explicit error on decision failure", () => {
  assert.match(RECOMPUTE, /from\("financial_snapshots"\)\.delete\(\)\.eq\("id",\s*snapRow\.id\)/);
  assert.match(RECOMPUTE, /snapshot_decision_persist_failed/);
});

test("[persist-4] recompute route runs prerequisite repair before building the snapshot", () => {
  const repairIdx = RECOMPUTE.indexOf("reason: \"financial_snapshot_recompute\"");
  // The actual snapshot BUILD call (not the import) is the awaited Promise.all entry.
  const buildIdx = RECOMPUTE.indexOf("buildDealFinancialSnapshotForBank({ dealId, bankId: access.bankId })");
  assert.ok(repairIdx > 0, "recompute must call ensureFinancialReadinessPrerequisites");
  assert.ok(buildIdx > 0);
  assert.ok(repairIdx < buildIdx, "repair must run before the snapshot build");
});
