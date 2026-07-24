import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm155 } from "@/lib/sba/forms/form155/build";

const COMPLETE_FIELDS = {
  sba_loan_number: "SBA-1234567-01",
  sba_loan_name: "Acme LLC",
  standby_borrower_name: "Acme LLC",
  standby_creditor_name: "Jane Seller",
  lender_name: "First National Bank",
  note_principal_amount: 100_000,
  note_interest_amount: 5_000,
  lenders_loan_amount: 500_000,
  agree_option: "1",
};

test("buildForm155: not applicable -> { applicable: false }", () => {
  const result = buildForm155({ applicable: false, fields: {}, borrowerOwnershipEntityId: null });
  assert.deepEqual(result, { form: "155", applicable: false });
});

test("buildForm155: applicable, fully complete + borrower signer resolved -> is_complete=true", () => {
  const result = buildForm155({ applicable: true, fields: COMPLETE_FIELDS, borrowerOwnershipEntityId: "o1" });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, true);
  assert.equal(result.missing.length, 0);
  assert.equal(result.standby_creditor_signable, false);
});

test("buildForm155: option 4 selected but option-4 rate/date not required at the flat-field level (still complete)", () => {
  const result = buildForm155({
    applicable: true,
    fields: { ...COMPLETE_FIELDS, agree_option: "4" },
    borrowerOwnershipEntityId: "o1",
  });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, true);
});

test("buildForm155: applicable but standby_creditor_name missing (real schema gap) -> flagged, is_complete=false", () => {
  const result = buildForm155({
    applicable: true,
    fields: { ...COMPLETE_FIELDS, standby_creditor_name: null },
    borrowerOwnershipEntityId: "o1",
  });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, false);
  assert.ok(result.missing.includes("standby_creditor_name"));
});

test("buildForm155: sba_loan_number missing (not yet SBA-assigned) -> flagged", () => {
  const result = buildForm155({
    applicable: true,
    fields: { ...COMPLETE_FIELDS, sba_loan_number: null },
    borrowerOwnershipEntityId: "o1",
  });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, false);
  assert.ok(result.missing.includes("sba_loan_number"));
});
