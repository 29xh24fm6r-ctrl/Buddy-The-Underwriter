import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm155 } from "@/lib/sba/forms/form155/build";

const COMPLETE_FIELDS = {
  borrower_legal_name: "Acme LLC",
  lender_name: "First National Bank",
  loan_amount: 500_000,
  standby_creditor_name: "Jane Seller",
  standby_creditor_address: "1 Seller Ln, Austin, TX",
  note_principal_amount: 100_000,
  note_date: "2026-01-01",
  full_standby_for_loan_term: true,
  subordination_terms_acknowledged: true,
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
