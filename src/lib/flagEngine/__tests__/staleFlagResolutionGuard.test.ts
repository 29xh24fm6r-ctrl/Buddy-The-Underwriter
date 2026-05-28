/**
 * BUGFIX-OD-MISMATCH-FLAG-IGNORES-SUPERSEDED-FACTS-1 — CI Guard Tests
 *
 * Guards:
 * 1. persistFlagReport resolves stale auto-generated flags absent from new output
 * 2. buildFlagEngineInput filters is_superseded = false
 * 3. flagFromReconciliation only fires mismatch when valid OD_DETAIL_TOTAL exists
 * 4. Superseded OD_DETAIL facts produce no mismatch flag
 */

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flagFromReconciliation } from "../flagFromReconciliation";
import { resetFlagCounter } from "../flagHelpers";
import type { FlagEngineInput } from "../types";

const repoRoot = resolve(__dirname, "../../../..");

function read(rel: string): string {
  return readFileSync(resolve(repoRoot, rel), "utf8");
}

function makeInput(facts: Record<string, unknown>, years: number[]): FlagEngineInput {
  resetFlagCounter();
  return { deal_id: "deal-1", canonical_facts: facts, ratios: {}, years_available: years };
}

const PERSIST = read("src/lib/flagEngine/persistFlagReport.ts");
const BUILD_INPUT = read("src/lib/flagEngine/buildFlagEngineInput.ts");

describe("BUGFIX-OD-MISMATCH-FLAG-IGNORES-SUPERSEDED-FACTS-1 guards", () => {

  test("Guard 1: persistFlagReport resolves stale flags absent from new output", () => {
    assert.match(
      PERSIST,
      /newFlagKeys/,
      "Must build set of new flag keys from engine output",
    );
    assert.match(
      PERSIST,
      /Auto-resolved: source facts no longer support this flag/,
      "Must mark stale flags with auto-resolution note",
    );
    assert.match(
      PERSIST,
      /auto_generated.*true/,
      "Must only auto-resolve auto_generated flags",
    );
  });

  test("Guard 2: buildFlagEngineInput filters is_superseded = false", () => {
    assert.match(
      BUILD_INPUT,
      /is_superseded.*false/,
      "Must filter superseded facts from engine input",
    );
  });

  test("Guard 3: no mismatch flag when OD_DETAIL_TOTAL is absent", () => {
    // Only aggregate exists, no detail → no mismatch
    const flags = flagFromReconciliation(makeInput({
      OTHER_DEDUCTIONS_2024: 2_340_232,
      GROSS_RECEIPTS_2024: 29_013_467,
      // No OD_DETAIL_TOTAL_2024
    }, [2024]));
    const mismatch = flags.find((f) => f.trigger_type === "other_deductions_detail_sum_mismatch");
    assert.ok(!mismatch, "No mismatch flag when OD_DETAIL_TOTAL is absent");
  });

  test("Guard 4: REGRESSION — superseded facts not in canonical_facts → no mismatch", () => {
    // Simulates post-supersession state: OD_DETAIL_TOTAL is gone from canonical_facts
    // because buildFlagEngineInput filters is_superseded=true
    const flags = flagFromReconciliation(makeInput({
      OTHER_DEDUCTIONS_2024: 2_340_232,
      GROSS_RECEIPTS_2024: 29_013_467,
      // OD_DETAIL_TOTAL_2024 is NOT present (superseded in DB)
    }, [2024]));
    const mismatch = flags.find((f) => f.trigger_type === "other_deductions_detail_sum_mismatch");
    assert.ok(!mismatch,
      "Must NOT produce mismatch flag when OD_DETAIL_TOTAL was superseded/removed from canonical_facts");

    // But large_other_expense should still fire (8.1%)
    const expense = flags.find((f) => f.trigger_type === "large_other_expense_5pct");
    assert.ok(expense, "large_other_expense_5pct should still fire from aggregate facts");
  });
});
