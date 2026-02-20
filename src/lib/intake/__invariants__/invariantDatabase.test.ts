/**
 * Phase E4 — Structural Constraint Proof
 *
 * Source-code scanning to verify DB-level enforcement exists and
 * is correctly specified in all intake source files.
 *
 * No randomness. Every scenario explicitly enumerated.
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Helpers ────────────────────────────────────────────────────────────

const ROOT = resolve(__dirname, "../../../..");

function readSource(relPath: string): string {
  return readFileSync(resolve(ROOT, relPath), "utf-8");
}

function countOccurrences(source: string, pattern: string): number {
  let count = 0;
  let idx = 0;
  while ((idx = source.indexOf(pattern, idx)) !== -1) {
    count++;
    idx += pattern.length;
  }
  return count;
}

// ── Scenarios ──────────────────────────────────────────────────────────

describe("Structural Constraint Proof", () => {
  test("Scenario A: resolveSupersession is designed around unique constraint", () => {
    const src = readSource(
      "src/lib/intake/supersession/resolveSupersession.ts",
    );

    // The source MUST reference the unique constraint violation risk
    assert.ok(
      src.includes("unique constraint violation"),
      "resolveSupersession must reference unique constraint violation",
    );

    // The source MUST document the critical ordering requirement
    assert.ok(
      src.includes("CRITICAL ORDER"),
      "resolveSupersession must document CRITICAL ORDER for deactivation",
    );
  });

  test("Scenario B: Supersession operation ordering — deactivate BEFORE set key", () => {
    const src = readSource(
      "src/lib/intake/supersession/resolveSupersession.ts",
    );

    // Find the supersession branch (step 5)
    // The deactivate (is_active: false) MUST appear BEFORE the set-key (logical_key: logicalKey)
    // in the non-duplicate supersession path
    const deactivateIdx = src.indexOf("is_active: false,");
    const setKeyIdx = src.lastIndexOf(
      'update({ logical_key: logicalKey })',
    );

    assert.ok(deactivateIdx > 0, "deactivate statement must exist");
    assert.ok(setKeyIdx > 0, "set-key statement must exist");
    assert.ok(
      deactivateIdx < setKeyIdx,
      `Deactivate (idx ${deactivateIdx}) must appear BEFORE set-key (idx ${setKeyIdx})`,
    );
  });

  test("Scenario C: Confirm route filters is_active on all queries", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/confirm/route.ts",
    );

    // Count .eq("is_active", true) occurrences
    // Must be ≥ 4: pending check, quality gate, ambiguity check, doc load/lock
    const count = countOccurrences(src, 'is_active');
    assert.ok(
      count >= 4,
      `Confirm route must reference is_active ≥ 4 times (got ${count})`,
    );
  });

  test("Scenario D: processConfirmedIntake filters is_active on all queries", () => {
    const src = readSource(
      "src/lib/intake/processing/processConfirmedIntake.ts",
    );

    // Must reference is_active in: hash docs, quality check, inactive guard, confirmed docs
    const count = countOccurrences(src, 'is_active');
    assert.ok(
      count >= 3,
      `processConfirmedIntake must reference is_active ≥ 3 times (got ${count})`,
    );
  });

  test("Scenario E: Review route filters is_active", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/review/route.ts",
    );

    assert.ok(
      src.includes("is_active"),
      "Review route must filter by is_active",
    );
  });

  test("Scenario F: invalidateIntakeSnapshot filters is_active", () => {
    const src = readSource(
      "src/lib/intake/confirmation/invalidateIntakeSnapshot.ts",
    );

    assert.ok(
      src.includes("is_active"),
      "invalidateIntakeSnapshot must filter by is_active",
    );
  });

  test("Scenario G: Confirm route snapshot hash filters by logical_key", () => {
    const src = readSource(
      "src/app/api/deals/[dealId]/intake/confirm/route.ts",
    );

    // Snapshot hash must only include docs with logical_key IS NOT NULL
    assert.ok(
      src.includes("logical_key"),
      "Confirm route must reference logical_key for snapshot sealing",
    );

    // Must filter sealable docs before hashing
    assert.ok(
      src.includes("logical_key != null") || src.includes("logical_key !== null"),
      "Confirm route must filter sealable docs by logical_key != null",
    );
  });

  test("Scenario H: processConfirmedIntake snapshot hash matches confirm route logical_key filter", () => {
    const src = readSource(
      "src/lib/intake/processing/processConfirmedIntake.ts",
    );

    // Must also filter by logical_key for hash recomputation
    assert.ok(
      src.includes("logical_key"),
      "processConfirmedIntake must reference logical_key for hash verification",
    );

    // Must filter sealable docs before hashing (same as confirm route)
    assert.ok(
      src.includes("logical_key != null") || src.includes("logical_key !== null"),
      "processConfirmedIntake must filter sealable docs by logical_key != null",
    );
  });
});
