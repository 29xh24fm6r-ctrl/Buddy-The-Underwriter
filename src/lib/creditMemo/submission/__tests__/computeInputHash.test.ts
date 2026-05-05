/**
 * Input Hash Determinism Guards
 *
 * Invariants enforced:
 *   1. Same inputs → same hash
 *   2. Different banker → different hash (banker is part of the certified set)
 *   3. Object key ordering does not affect hash
 *   4. Override changes affect hash
 *   5. Memo metric changes affect hash
 */

import test from "node:test";
import assert from "node:assert/strict";

import { computeInputHash } from "@/lib/creditMemo/submission/computeInputHash";
import type { CanonicalCreditMemoV1 } from "@/lib/creditMemo/canonical/types";

function memo(loanAmount: number = 1_000_000): CanonicalCreditMemoV1 {
  return {
    deal_id: "deal-1",
    bank_id: "bank-1",
    version: "canonical_v1",
    generated_at: "2026-05-05T00:00:00.000Z",
    key_metrics: { loan_amount: { value: loanAmount } },
    financial_analysis: { dscr: { value: 1.4 } },
    collateral: { gross_value: { value: 1_500_000 } },
    business_summary: { business_description: "stub" },
    management_qualifications: {
      principals: [{ id: "p1", bio: "x".repeat(50) }],
    },
  } as unknown as CanonicalCreditMemoV1;
}

test("[hash-1] same inputs → same hash", () => {
  const h1 = computeInputHash({
    memo: memo(),
    overrides: { business_description: "abc" },
    bankerId: "user_a",
  });
  const h2 = computeInputHash({
    memo: memo(),
    overrides: { business_description: "abc" },
    bankerId: "user_a",
  });
  assert.equal(h1, h2);
});

test("[hash-2] different banker → different hash", () => {
  const h1 = computeInputHash({
    memo: memo(),
    overrides: {},
    bankerId: "user_a",
  });
  const h2 = computeInputHash({
    memo: memo(),
    overrides: {},
    bankerId: "user_b",
  });
  assert.notEqual(h1, h2);
});

test("[hash-3] object key ordering does not affect hash", () => {
  const h1 = computeInputHash({
    memo: memo(),
    overrides: { a: 1, b: 2, c: 3 },
    bankerId: "user_a",
  });
  const h2 = computeInputHash({
    memo: memo(),
    overrides: { c: 3, a: 1, b: 2 },
    bankerId: "user_a",
  });
  assert.equal(h1, h2);
});

test("[hash-4] override change → different hash", () => {
  const h1 = computeInputHash({
    memo: memo(),
    overrides: { business_description: "abc" },
    bankerId: "user_a",
  });
  const h2 = computeInputHash({
    memo: memo(),
    overrides: { business_description: "xyz" },
    bankerId: "user_a",
  });
  assert.notEqual(h1, h2);
});

test("[hash-5] memo loan amount change → different hash", () => {
  const h1 = computeInputHash({
    memo: memo(1_000_000),
    overrides: {},
    bankerId: "user_a",
  });
  const h2 = computeInputHash({
    memo: memo(2_000_000),
    overrides: {},
    bankerId: "user_a",
  });
  assert.notEqual(h1, h2);
});

test("[hash-6] returns 64-char hex SHA-256", () => {
  const h = computeInputHash({
    memo: memo(),
    overrides: {},
    bankerId: "user_a",
  });
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]{64}$/);
});
