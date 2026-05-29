/**
 * SPEC-FLAG-ENGINE-EXCLUDE-SYSTEM-INVALIDATED-FACTS-1 — regression guards
 *
 * buildFlagEngineInput must never feed invalidated facts to the engine. It
 * already excluded is_superseded=true and resolution_status='rejected'; it must
 * ALSO exclude resolution_status='system_invalidated' — because a fact can be
 * invalidated while is_superseded was left false (an upsert can reset the flag
 * without clearing the status), letting stale/partial data re-trigger flags.
 *
 * buildFlagEngineInput is server-only (imports supabaseAdmin) so it cannot be
 * imported here; we guard the query filter via source pattern and prove the
 * downstream engine behavior with the pure flagFromReconciliation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { flagFromReconciliation } from "../flagFromReconciliation";
import { resetFlagCounter } from "../flagHelpers";
import type { FlagEngineInput } from "../types";

const BUILD_INPUT = readFileSync(
  resolve(__dirname, "../buildFlagEngineInput.ts"),
  "utf8",
);

function makeInput(facts: Record<string, unknown>, years: number[]): FlagEngineInput {
  resetFlagCounter();
  return { deal_id: "deal-1", canonical_facts: facts, ratios: {}, years_available: years };
}

describe("SPEC-FLAG-ENGINE-EXCLUDE-SYSTEM-INVALIDATED-FACTS-1", () => {
  it("buildFlagEngineInput excludes system_invalidated facts (and preserves rejected/superseded)", () => {
    // Existing behavior preserved.
    assert.match(BUILD_INPUT, /\.eq\("is_superseded", false\)/);
    assert.match(BUILD_INPUT, /\.neq\("resolution_status", "rejected"\)/);
    // New exclusion.
    assert.match(BUILD_INPUT, /\.neq\("resolution_status", "system_invalidated"\)/);
  });

  it("an unsuperseded system_invalidated OD_DETAIL_TOTAL is filtered out → no mismatch flag", () => {
    // Post-filter canonical_facts: the system_invalidated OD_DETAIL_TOTAL fact
    // was excluded by buildFlagEngineInput, so it is absent here even though the
    // aggregate OTHER_DEDUCTIONS remains. The engine must NOT produce a mismatch.
    const flags = flagFromReconciliation(makeInput({
      OTHER_DEDUCTIONS_2024: 2_340_232,
      GROSS_RECEIPTS_2024: 28_891_753,
      // OD_DETAIL_TOTAL_2024 intentionally absent (filtered: system_invalidated)
    }, [2024]));

    assert.ok(
      !flags.find((f) => f.trigger_type === "other_deductions_detail_sum_mismatch"),
      "must NOT produce other_deductions_detail_sum_mismatch from a filtered system_invalidated fact",
    );
    // The aggregate-derived flag still fires (it does not depend on OD detail).
    assert.ok(
      flags.find((f) => f.trigger_type === "large_other_expense_5pct"),
      "large_other_expense_5pct still fires from the aggregate fact",
    );
  });
});
