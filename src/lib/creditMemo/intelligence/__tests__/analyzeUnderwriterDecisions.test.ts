/**
 * Analyze Underwriter Decisions Guards
 *
 * Invariants enforced:
 *   1. Empty input → all-zeros analytics
 *   2. Approval rate calculated correctly
 *   3. Return rate calculated correctly
 *   4. Common return reasons aggregated and sorted
 *   5. Avg cycles to final decision uses memo_version of last finalized row
 *   6. Empty {} feedback rows are ignored (the gate's default)
 *   7. Section_key is used as fallback when comment is missing
 *   8. Pure: same inputs produce identical output
 */

import test from "node:test";
import assert from "node:assert/strict";

import { analyzeUnderwriterDecisions } from "@/lib/creditMemo/intelligence/analyzeUnderwriterDecisions";
import type { IntelligenceSnapshotRow } from "@/lib/creditMemo/intelligence/types";

function snapshotRow(
  id: string,
  memoVersion: number,
  feedback: unknown,
): IntelligenceSnapshotRow {
  return {
    id,
    memo_version: memoVersion,
    memo_output_json: { sections: {} },
    underwriter_feedback_json: feedback,
  };
}

// ─── Empty inputs ────────────────────────────────────────────────────────

test("[ud-1] empty input → all zeros, null avg cycles", () => {
  const result = analyzeUnderwriterDecisions([]);
  assert.equal(result.total_decisions, 0);
  assert.equal(result.approvals, 0);
  assert.equal(result.declines, 0);
  assert.equal(result.returns, 0);
  assert.equal(result.approval_rate, 0);
  assert.equal(result.return_rate, 0);
  assert.equal(result.avg_cycles_to_final_decision, null);
  assert.deepEqual(result.common_return_reasons, []);
});

test("[ud-2] empty {} feedback rows are ignored", () => {
  const rows = [
    snapshotRow("s1", 1, {}),
    snapshotRow("s2", 2, {}),
  ];
  const result = analyzeUnderwriterDecisions(rows);
  assert.equal(result.total_decisions, 0);
});

// ─── Counts and rates ────────────────────────────────────────────────────

test("[ud-3] computes approval and return rate", () => {
  const rows = [
    snapshotRow("s1", 1, { decision: "approved" }),
    snapshotRow("s2", 2, { decision: "returned_for_revision" }),
    snapshotRow("s3", 3, { decision: "returned_for_revision" }),
    snapshotRow("s4", 4, { decision: "approved" }),
  ];
  const result = analyzeUnderwriterDecisions(rows);
  assert.equal(result.total_decisions, 4);
  assert.equal(result.approvals, 2);
  assert.equal(result.returns, 2);
  assert.equal(result.approval_rate, 0.5);
  assert.equal(result.return_rate, 0.5);
});

test("[ud-4] declines are counted separately", () => {
  const rows = [
    snapshotRow("s1", 1, { decision: "declined" }),
    snapshotRow("s2", 2, { decision: "approved" }),
  ];
  const result = analyzeUnderwriterDecisions(rows);
  assert.equal(result.declines, 1);
  assert.equal(result.approvals, 1);
});

// ─── Return reason aggregation ───────────────────────────────────────────

test("[ud-5] aggregates and sorts common return reasons", () => {
  const rows = [
    snapshotRow("s1", 1, {
      decision: "returned_for_revision",
      requested_changes: [
        { section_key: "collateral", comment: "weak collateral explanation", severity: "material" },
        { section_key: "management_qualifications", comment: "management bio sparse", severity: "moderate" },
      ],
    }),
    snapshotRow("s2", 2, {
      decision: "returned_for_revision",
      requested_changes: [
        { section_key: "collateral", comment: "weak collateral explanation", severity: "material" },
      ],
    }),
  ];
  const result = analyzeUnderwriterDecisions(rows);
  assert.equal(result.common_return_reasons.length, 2);
  assert.equal(result.common_return_reasons[0].reason, "weak collateral explanation");
  assert.equal(result.common_return_reasons[0].count, 2);
  assert.equal(result.common_return_reasons[1].count, 1);
});

test("[ud-6] section_key is fallback when comment is empty", () => {
  const rows = [
    snapshotRow("s1", 1, {
      decision: "returned_for_revision",
      requested_changes: [
        { section_key: "policy_exceptions", comment: "", severity: "minor" },
      ],
    }),
  ];
  const result = analyzeUnderwriterDecisions(rows);
  assert.equal(result.common_return_reasons[0].reason, "policy_exceptions");
});

// ─── Avg cycles to final ─────────────────────────────────────────────────

test("[ud-7] avg cycles uses last finalized memo_version - 1", () => {
  const rows = [
    snapshotRow("s1", 1, { decision: "returned_for_revision" }),
    snapshotRow("s2", 2, { decision: "returned_for_revision" }),
    snapshotRow("s3", 3, { decision: "approved" }),
  ];
  const result = analyzeUnderwriterDecisions(rows);
  assert.equal(result.avg_cycles_to_final_decision, 2); // v3 final → 2 cycles preceding
});

test("[ud-8] avg cycles is null when no final decision recorded", () => {
  const rows = [
    snapshotRow("s1", 1, { decision: "returned_for_revision" }),
    snapshotRow("s2", 2, { decision: "returned_for_revision" }),
  ];
  const result = analyzeUnderwriterDecisions(rows);
  assert.equal(result.avg_cycles_to_final_decision, null);
});

// ─── Determinism ─────────────────────────────────────────────────────────

test("[ud-9] same inputs produce identical output", () => {
  const rows = [
    snapshotRow("s1", 1, { decision: "approved" }),
    snapshotRow("s2", 2, { decision: "returned_for_revision" }),
  ];
  const a = analyzeUnderwriterDecisions(rows);
  const b = analyzeUnderwriterDecisions(rows);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
