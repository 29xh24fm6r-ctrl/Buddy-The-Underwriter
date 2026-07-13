import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm148 } from "@/lib/sba/forms/form148/build";

const COMPLETE_FIELDS = {
  guarantor_name: "Jane Doe",
  guarantor_address_street: "1 Main St",
  guarantor_address_city: "Austin",
  guarantor_address_state: "TX",
  guarantor_address_zip: "78701",
  borrower_legal_name: "Acme LLC",
  lender_name: "First National Bank",
  loan_amount: 500_000,
  ownership_pct: 25,
};

test("buildForm148: unconditional signer, fully complete -> is_complete=true", () => {
  const result = buildForm148({ signers: [{ ownership_entity_id: "o1", guaranteeType: "unconditional", fields: COMPLETE_FIELDS }] });
  assert.equal(result.is_complete, true);
  assert.equal(result.missing[0].missing.length, 0);
});

test("buildForm148: limited signer missing cap amount -> flagged, is_complete=false", () => {
  const result = buildForm148({
    signers: [{ ownership_entity_id: "o1", guaranteeType: "limited", fields: { ...COMPLETE_FIELDS, ownership_pct: 10, limited_guarantee_cap_amount: null } }],
  });
  assert.equal(result.is_complete, false);
  assert.ok(result.missing[0].missing.includes("limited_guarantee_cap_amount"));
});

test("buildForm148: limited signer WITH cap amount -> is_complete=true", () => {
  const result = buildForm148({
    signers: [{ ownership_entity_id: "o1", guaranteeType: "limited", fields: { ...COMPLETE_FIELDS, ownership_pct: 10, limited_guarantee_cap_amount: 50_000 } }],
  });
  assert.equal(result.is_complete, true);
});

test("buildForm148: no signers -> is_complete=false", () => {
  const result = buildForm148({ signers: [] });
  assert.equal(result.is_complete, false);
  assert.deepEqual(result.signatures, []);
});
