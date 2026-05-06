/**
 * detectFactConflicts pure tests.
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  detectFactConflicts,
  type FactCandidate,
} from "@/lib/creditMemo/inputs/detectFactConflicts";

function c(
  fact_key: string,
  source_role: FactCandidate["source_role"],
  value: number,
  extras: Partial<FactCandidate> = {},
): FactCandidate {
  return {
    fact_key,
    source_label: source_role,
    source_role,
    value,
    period_end: null,
    ...extras,
  };
}

test("[conflict-1] no conflict when all sources agree", () => {
  const out = detectFactConflicts([
    c("revenue", "tax_return", 1_000_000),
    c("revenue", "income_statement", 1_000_000),
    c("revenue", "banker_override", 1_000_000),
  ]);
  assert.equal(out.length, 0);
});

test("[conflict-2] single source produces no conflict", () => {
  const out = detectFactConflicts([c("revenue", "tax_return", 500_000)]);
  assert.equal(out.length, 0);
});

test("[conflict-3] material mismatch produces value_mismatch conflict", () => {
  const out = detectFactConflicts([
    c("revenue", "tax_return", 1_000_000),
    c("revenue", "income_statement", 1_400_000),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].fact_key, "revenue");
  assert.equal(out[0].conflict_type, "value_mismatch");
  assert.equal(out[0].status, "open");
});

test("[conflict-4] sub-tolerance differences are not flagged", () => {
  // 1% tolerance → $9,900 vs $10,000 should not be a conflict.
  const out = detectFactConflicts([
    c("ebitda", "income_statement", 10_000),
    c("ebitda", "tax_return", 9_900),
  ]);
  assert.equal(out.length, 0);
});

test("[conflict-5] picks the most-divergent pair when N sources disagree", () => {
  const out = detectFactConflicts([
    c("revenue", "tax_return", 1_000_000),
    c("revenue", "income_statement", 1_050_000),
    c("revenue", "banker_override", 1_500_000),
  ]);
  assert.equal(out.length, 1);
  const values = [
    (out[0].source_a as any).value,
    (out[0].source_b as any).value,
  ].sort((a, b) => a - b);
  assert.deepEqual(values, [1_000_000, 1_500_000]);
});

test("[conflict-6] non-numeric values are skipped", () => {
  const out = detectFactConflicts([
    c("revenue", "tax_return", 1_000_000),
    {
      fact_key: "revenue",
      source_label: "ledger",
      source_role: "income_statement",
      value: null,
    } as FactCandidate,
  ]);
  assert.equal(out.length, 0);
});

test("[conflict-7] same role + same period dedupes to most recent", () => {
  const out = detectFactConflicts([
    c("revenue", "income_statement", 1_000_000, {
      period_end: "2024-12-31",
      recorded_at: "2026-01-01",
    }),
    c("revenue", "income_statement", 999_999, {
      period_end: "2024-12-31",
      recorded_at: "2025-12-01",
    }),
    c("revenue", "tax_return", 1_500_000, {
      period_end: "2024-12-31",
    }),
  ]);
  // The 999,999 (older) should be dropped; comparison uses 1,000,000 vs 1,500,000.
  assert.equal(out.length, 1);
  const values = [
    (out[0].source_a as any).value,
    (out[0].source_b as any).value,
  ].sort((a, b) => a - b);
  assert.deepEqual(values, [1_000_000, 1_500_000]);
});

test("[conflict-8] conflicts populate source_a/source_b with role + value", () => {
  const out = detectFactConflicts([
    c("loan_amount", "financial_snapshot", 1_000_000),
    c("loan_amount", "banker_override", 1_500_000),
  ]);
  assert.equal(out.length, 1);
  const a = out[0].source_a as Record<string, unknown>;
  const b = out[0].source_b as Record<string, unknown>;
  assert.ok(typeof a.value === "number");
  assert.ok(typeof b.value === "number");
  assert.ok(typeof a.role === "string");
  assert.ok(typeof b.role === "string");
});
