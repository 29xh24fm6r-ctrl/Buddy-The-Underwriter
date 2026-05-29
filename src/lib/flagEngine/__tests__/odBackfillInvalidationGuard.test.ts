/**
 * BUGFIX-OD-BACKFILL-INVALIDATION-REGENERATES-AFTER-CLEANUP-1 — CI Guards
 *
 * Root cause: fact invalidation and flag cleanup were not one workflow. A bad
 * backfill wrote $9.73B OD_DETAIL facts and generated an
 * other_deductions_detail_sum_mismatch flag; the facts were later superseded,
 * but no regenerate/persist pass ran afterward, so the stale flag stayed open.
 *
 * Guards:
 * 1. persistFlagReport's stale cleanup runs even when the engine output is empty
 *    (not gated behind the zero-flags early return).
 * 2. persistFlagReport has a direct OD-mismatch safety net keyed on a live
 *    OD_DETAIL_TOTAL fact for the flagged year.
 * 3. The cleanup covers both `open` and `banker_reviewed` auto_generated flags.
 * 4. The backfill route supersedes pre-existing live OD_DETAIL facts when the
 *    plausibility gate rejects an extraction.
 * 5. Sequence (pure engine): bad OD_DETAIL_TOTAL → mismatch + large_other_expense
 *    both fire; after supersession only large_other_expense remains.
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
const BACKFILL = read("src/app/api/deals/[dealId]/flags/od-detail/backfill/route.ts");

describe("BUGFIX-OD-BACKFILL-INVALIDATION-REGENERATES-AFTER-CLEANUP-1 guards", () => {

  test("Guard 1: stale cleanup runs on the empty-output path, not only when flags exist", () => {
    assert.match(
      PERSIST,
      /resolveStaleAutoFlags/,
      "Cleanup must be a reusable helper",
    );
    // The zero-flags early return must invoke the helper before returning.
    const emptyBranch = PERSIST.slice(
      PERSIST.indexOf("output.flags.length === 0"),
      PERSIST.indexOf("return { ok: true, flagCount: 0 }"),
    );
    assert.match(
      emptyBranch,
      /resolveStaleAutoFlags\(sb, dealId, new Set/,
      "Empty engine output must still resolve stale auto-generated flags",
    );
  });

  test("Guard 2: direct OD-mismatch safety net keyed on live OD_DETAIL_TOTAL", () => {
    assert.match(PERSIST, /resolveOrphanedOdMismatchFlags/, "Must have an OD-mismatch safety net");
    assert.match(PERSIST, /other_deductions_detail_sum_mismatch/, "Safety net targets the mismatch trigger");
    assert.match(PERSIST, /OD_DETAIL_TOTAL/, "Safety net checks for a live OD_DETAIL_TOTAL fact");
    assert.match(
      PERSIST,
      /no live OD_DETAIL_TOTAL fact supports this mismatch flag/,
      "Safety net resolution note must be explicit",
    );
  });

  test("Guard 3: cleanup covers open AND banker_reviewed auto_generated flags", () => {
    assert.match(PERSIST, /\["open", "banker_reviewed"\]/, "Must include open and banker_reviewed statuses");
    assert.match(PERSIST, /auto_generated.*true/, "Must only auto-resolve auto_generated flags");
  });

  test("Guard 4: backfill supersedes pre-existing live OD_DETAIL facts when gate rejects", () => {
    assert.match(
      BACKFILL,
      /is_superseded: true, resolution_status: "system_invalidated"/,
      "Reject branch must supersede + invalidate stale OD_DETAIL facts",
    );
    assert.match(BACKFILL, /\.like\("fact_key", "OD_DETAIL%"\)/, "Must target OD_DETAIL fact keys");
    // The supersession must sit inside the plausibility-reject branch (before the
    // continue), and the route must still regenerate flags at the end.
    assert.match(BACKFILL, /generateAndPersistFlags\(dealId, bankId\)/, "Route must regenerate flags after the loop");
  });

  test("Guard 5: sequence — bad detail flags mismatch; after supersession only large_other_expense remains", () => {
    // Before supersession: bad $9.73B detail total present alongside the real aggregate.
    const before = flagFromReconciliation(makeInput({
      OTHER_DEDUCTIONS_2024: 2_340_232,
      GROSS_RECEIPTS_2024: 28_891_753, // 2,340,232 / revenue = 8.1%
      OD_DETAIL_TOTAL_2024: 9_729_428_458,
    }, [2024]));
    assert.ok(
      before.find((f) => f.trigger_type === "other_deductions_detail_sum_mismatch"),
      "mismatch fires while the bad OD_DETAIL_TOTAL is present",
    );
    assert.ok(
      before.find((f) => f.trigger_type === "large_other_expense_5pct"),
      "large_other_expense_5pct also fires (8.1% of revenue)",
    );

    // After supersession: buildFlagEngineInput filters is_superseded=true, so
    // OD_DETAIL_TOTAL_2024 is no longer in canonical_facts.
    const after = flagFromReconciliation(makeInput({
      OTHER_DEDUCTIONS_2024: 2_340_232,
      GROSS_RECEIPTS_2024: 28_891_753,
    }, [2024]));
    assert.ok(
      !after.find((f) => f.trigger_type === "other_deductions_detail_sum_mismatch"),
      "mismatch is gone once the source fact is superseded — Elevated 2 → 1",
    );
    assert.ok(
      after.find((f) => f.trigger_type === "large_other_expense_5pct"),
      "large_other_expense_5pct remains open",
    );
  });
});
