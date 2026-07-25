import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSbaNote } from "@/lib/sba/forms/sbaNote/build";
import { standardLateChargeText, standardPrepaymentPenaltyText } from "@/lib/sba/forms/sbaNote/fields";

const COMPLETE_FIELDS = {
  borrower_legal_name: "Acme LLC",
  lender_name: "First National Bank",
  lender_address: null,
  principal_amount: 500_000,
  interest_rate_pct: 8.5,
  rate_type: "fixed" as const,
  rate_index: null,
  rate_spread_bps: null,
  term_months: 120,
  amort_months: 120,
  interest_only_months: null,
  payment_frequency: "monthly",
  use_of_proceeds_summary: "Working capital",
  collateral_summary: [],
  guarantors: [],
};

test("buildSbaNote: complete fields + resolved signer -> is_complete=true", () => {
  const result = buildSbaNote({
    fields: COMPLETE_FIELDS,
    lateChargeOverrideText: null,
    prepaymentPenaltyOverrideText: null,
    borrowerOwnershipEntityId: "o1",
  });
  assert.equal(result.is_complete, true);
  assert.equal(result.missing.length, 0);
  assert.equal(result.legal_review.approved, false);
});

test("buildSbaNote: missing principal amount -> flagged incomplete", () => {
  const result = buildSbaNote({
    fields: { ...COMPLETE_FIELDS, principal_amount: null },
    lateChargeOverrideText: null,
    prepaymentPenaltyOverrideText: null,
    borrowerOwnershipEntityId: "o1",
  });
  assert.equal(result.is_complete, false);
  assert.ok(result.missing.includes("principal_amount"));
});

test("buildSbaNote: no resolved borrower signer -> is_complete=false even with all fields present", () => {
  const result = buildSbaNote({
    fields: COMPLETE_FIELDS,
    lateChargeOverrideText: null,
    prepaymentPenaltyOverrideText: null,
    borrowerOwnershipEntityId: null,
  });
  assert.equal(result.is_complete, false);
});

test("buildSbaNote: banker override text wins over SBA-standard default", () => {
  const result = buildSbaNote({
    fields: COMPLETE_FIELDS,
    lateChargeOverrideText: "Custom late charge language.",
    prepaymentPenaltyOverrideText: "Custom prepayment language.",
    borrowerOwnershipEntityId: "o1",
  });
  assert.equal(result.input.late_charge_text, "Custom late charge language.");
  assert.equal(result.input.prepayment_penalty_text, "Custom prepayment language.");
});

test("buildSbaNote: blank override text falls back to SBA-standard default, not an empty clause", () => {
  const result = buildSbaNote({
    fields: COMPLETE_FIELDS,
    lateChargeOverrideText: "   ",
    prepaymentPenaltyOverrideText: "",
    borrowerOwnershipEntityId: "o1",
  });
  assert.equal(result.input.late_charge_text, standardLateChargeText());
  assert.equal(result.input.prepayment_penalty_text, standardPrepaymentPenaltyText(120));
});

test("standardPrepaymentPenaltyText: no penalty under 15-year term", () => {
  assert.match(standardPrepaymentPenaltyText(120), /without penalty/);
});

test("standardPrepaymentPenaltyText: declining schedule for 15+ year term", () => {
  const text = standardPrepaymentPenaltyText(240);
  assert.match(text, /5%/);
  assert.match(text, /3%/);
  assert.match(text, /1%/);
});

test("standardPrepaymentPenaltyText: unknown term -> deferred, not a false 'no penalty' claim", () => {
  assert.match(standardPrepaymentPenaltyText(null), /not yet been determined/);
});
