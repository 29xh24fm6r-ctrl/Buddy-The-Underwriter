/**
 * Diff Snapshots Guards
 *
 * Invariants enforced:
 *   1. Identical snapshots → no changed sections
 *   2. Narrative changes are detected
 *   3. Table value changes are detected
 *   4. Material paths (debt_coverage, collateral, policy_exceptions,
 *      financing_request, global_cash_flow, management_qualifications,
 *      recommendation_approval) are flagged 'material'
 *   5. Non-material section changes are flagged 'minor' or 'moderate'
 *   6. Pure: same inputs produce identical diff output
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  diffSnapshots,
  severityForPath,
  stableJson,
} from "@/lib/creditMemo/intelligence/diffSnapshots";
import type { IntelligenceSnapshotRow } from "@/lib/creditMemo/intelligence/types";

function snapshotRow(
  id: string,
  memoVersion: number,
  memo: Record<string, unknown>,
): IntelligenceSnapshotRow {
  return {
    id,
    memo_version: memoVersion,
    memo_output_json: memo,
    underwriter_feedback_json: null,
  };
}

function memoWith(sections: Record<string, unknown>): Record<string, unknown> {
  return { sections };
}

// ─── stableJson ──────────────────────────────────────────────────────────

test("[stable-json] sorts object keys and equates equivalent shapes", () => {
  assert.equal(stableJson({ b: 2, a: 1 }), stableJson({ a: 1, b: 2 }));
});

test("[stable-json] handles arrays, primitives, and nulls", () => {
  assert.equal(stableJson(null), "null");
  assert.equal(stableJson([1, 2, 3]), "[1,2,3]");
  assert.equal(stableJson("x"), '"x"');
});

// ─── severityForPath ────────────────────────────────────────────────────

test("[severity-1] debt_coverage is material", () => {
  assert.equal(severityForPath("sections.debt_coverage.data.dscr"), "material");
});

test("[severity-2] collateral is material", () => {
  assert.equal(severityForPath("sections.collateral.tables"), "material");
});

test("[severity-3] policy_exceptions is material", () => {
  assert.equal(severityForPath("sections.policy_exceptions.data.exceptions"), "material");
});

test("[severity-4] narrative is moderate", () => {
  assert.equal(severityForPath("sections.borrower_sponsor.narrative"), "moderate");
});

test("[severity-5] tables-related path is moderate", () => {
  assert.equal(severityForPath("sections.eligibility.tables"), "moderate");
});

test("[severity-6] arbitrary leaf is minor", () => {
  assert.equal(severityForPath("sections.eligibility.data.naics_code"), "minor");
});

// ─── diffSnapshots — equivalence cases ──────────────────────────────────

test("[diff-1] identical snapshots → no changed sections", () => {
  const memo = memoWith({
    debt_coverage: { title: "Debt Coverage", data: { financial_analysis: { dscr: { value: 1.4 } } } },
  });
  const a = snapshotRow("s1", 1, memo);
  const b = snapshotRow("s2", 2, JSON.parse(JSON.stringify(memo)));
  const diff = diffSnapshots(a, b);
  assert.equal(diff.changed_sections.length, 0);
  assert.equal(diff.material_changes.length, 0);
  assert.match(diff.summary, /No changes/i);
});

// ─── diffSnapshots — change detection ───────────────────────────────────

test("[diff-2] narrative change is detected and tagged moderate", () => {
  const before = snapshotRow("s1", 1, memoWith({
    borrower_sponsor: { title: "Borrower", narrative: "Old", data: {} },
  }));
  const after = snapshotRow("s2", 2, memoWith({
    borrower_sponsor: { title: "Borrower", narrative: "New", data: {} },
  }));
  const diff = diffSnapshots(before, after);
  assert.equal(diff.changed_sections.length, 1);
  const change = diff.changed_sections[0].changes.find((c) => c.path.endsWith("narrative"));
  assert.ok(change);
  assert.equal(change!.severity, "moderate");
  assert.equal(change!.before, "Old");
  assert.equal(change!.after, "New");
});

test("[diff-3] table value change in debt_coverage is material", () => {
  const before = snapshotRow("s1", 1, memoWith({
    debt_coverage: {
      title: "Debt Coverage",
      data: { financial_analysis: { dscr: { value: 1.18 } } },
      tables: [],
    },
  }));
  const after = snapshotRow("s2", 2, memoWith({
    debt_coverage: {
      title: "Debt Coverage",
      data: { financial_analysis: { dscr: { value: 1.32 } } },
      tables: [],
    },
  }));
  const diff = diffSnapshots(before, after);
  assert.equal(diff.changed_sections.length, 1);
  const change = diff.changed_sections[0].changes.find((c) => c.path.endsWith("value"));
  assert.ok(change);
  assert.equal(change!.severity, "material");
  assert.equal(diff.material_changes.length >= 1, true);
});

test("[diff-4] collateral change is material", () => {
  const before = snapshotRow("s1", 1, memoWith({
    collateral: { title: "Collateral", data: { collateral: { gross_value: { value: 1_000_000 } } } },
  }));
  const after = snapshotRow("s2", 2, memoWith({
    collateral: { title: "Collateral", data: { collateral: { gross_value: { value: 1_500_000 } } } },
  }));
  const diff = diffSnapshots(before, after);
  assert.equal(diff.material_changes.length >= 1, true);
});

test("[diff-5] policy_exceptions count change is material", () => {
  const before = snapshotRow("s1", 1, memoWith({
    policy_exceptions: { title: "Exceptions", data: { exceptions: [{ id: "1" }, { id: "2" }] } },
  }));
  const after = snapshotRow("s2", 2, memoWith({
    policy_exceptions: { title: "Exceptions", data: { exceptions: [{ id: "1" }] } },
  }));
  const diff = diffSnapshots(before, after);
  assert.equal(diff.material_changes.length >= 1, true);
});

test("[diff-6] section addition is detected", () => {
  const before = snapshotRow("s1", 1, memoWith({}));
  const after = snapshotRow("s2", 2, memoWith({
    debt_coverage: { title: "DC", data: { financial_analysis: { dscr: { value: 1.4 } } } },
  }));
  const diff = diffSnapshots(before, after);
  assert.equal(diff.changed_sections.length, 1);
  assert.equal(diff.changed_sections[0].section_key, "debt_coverage");
});

test("[diff-7] meta carries from/to snapshot ids and versions", () => {
  const before = snapshotRow("s1", 3, memoWith({
    eligibility: { title: "E", data: { naics_code: "722513" } },
  }));
  const after = snapshotRow("s2", 4, memoWith({
    eligibility: { title: "E", data: { naics_code: "722514" } },
  }));
  const diff = diffSnapshots(before, after);
  assert.equal(diff.from_snapshot_id, "s1");
  assert.equal(diff.to_snapshot_id, "s2");
  assert.equal(diff.from_version, 3);
  assert.equal(diff.to_version, 4);
});

// ─── diffSnapshots — purity ─────────────────────────────────────────────

test("[diff-8] same inputs produce identical output", () => {
  const before = snapshotRow("s1", 1, memoWith({
    collateral: { title: "C", data: { collateral: { gross_value: { value: 1_000_000 } } } },
  }));
  const after = snapshotRow("s2", 2, memoWith({
    collateral: { title: "C", data: { collateral: { gross_value: { value: 1_500_000 } } } },
  }));
  const a = diffSnapshots(before, after);
  const b = diffSnapshots(before, after);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});
