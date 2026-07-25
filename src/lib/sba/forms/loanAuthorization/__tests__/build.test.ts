import { test } from "node:test";
import assert from "node:assert/strict";
import { buildLoanAuthorization } from "@/lib/sba/forms/loanAuthorization/build";

const COMPLETE_FIELDS = {
  borrower_legal_name: "Acme LLC",
  lender_name: "First National Bank",
  principal_amount: 500_000,
  interest_rate_pct: 8.5,
  rate_type: "fixed" as const,
  term_months: 120,
  use_of_proceeds_summary: "Working capital",
  collateral_summary: [],
  guarantors: [],
  deal_covenants: [],
};

test("buildLoanAuthorization: complete fields + resolved signer -> is_complete=true", () => {
  const result = buildLoanAuthorization({ fields: COMPLETE_FIELDS, borrowerOwnershipEntityId: "o1" });
  assert.equal(result.is_complete, true);
  assert.equal(result.missing.length, 0);
  assert.equal(result.legal_review.approved, false);
});

test("buildLoanAuthorization: missing loan term -> flagged incomplete", () => {
  const result = buildLoanAuthorization({ fields: { ...COMPLETE_FIELDS, term_months: null }, borrowerOwnershipEntityId: "o1" });
  assert.equal(result.is_complete, false);
  assert.ok(result.missing.includes("term_months"));
});

test("buildLoanAuthorization: no resolved borrower signer -> is_complete=false", () => {
  const result = buildLoanAuthorization({ fields: COMPLETE_FIELDS, borrowerOwnershipEntityId: null });
  assert.equal(result.is_complete, false);
});

test("buildLoanAuthorization: always includes the standard conditions/covenants boilerplate", () => {
  const result = buildLoanAuthorization({ fields: COMPLETE_FIELDS, borrowerOwnershipEntityId: "o1" });
  assert.ok(result.input.conditions_precedent.length > 0);
  assert.ok(result.input.affirmative_covenants.length > 0);
  assert.ok(result.input.negative_covenants.length > 0);
  assert.ok(result.input.conditions_subsequent.length > 0);
});

test("buildLoanAuthorization: deal-specific covenants pass through untouched", () => {
  const covenants = [{ metric: "DSCR", threshold: "1.25x minimum", testing_frequency: "quarterly" }];
  const result = buildLoanAuthorization({ fields: { ...COMPLETE_FIELDS, deal_covenants: covenants }, borrowerOwnershipEntityId: "o1" });
  assert.deepEqual(result.input.deal_covenants, covenants);
});
