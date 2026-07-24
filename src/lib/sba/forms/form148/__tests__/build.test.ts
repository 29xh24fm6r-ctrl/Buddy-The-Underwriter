import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm148 } from "@/lib/sba/forms/form148/build";

const COMPLETE_FIELDS = {
  guarantor_name: "Jane Doe",
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

test("buildForm148: limited signer missing limitation type -> flagged, is_complete=false", () => {
  const result = buildForm148({
    signers: [{ ownership_entity_id: "o1", guaranteeType: "limited", fields: { ...COMPLETE_FIELDS, ownership_pct: 10 } }],
  });
  assert.equal(result.is_complete, false);
  assert.ok(result.missing[0].missing.includes("guarantee_limitation_type"));
});

test("buildForm148: limited signer WITH limitation type -> is_complete=true", () => {
  const result = buildForm148({
    signers: [
      {
        ownership_entity_id: "o1",
        guaranteeType: "limited",
        fields: { ...COMPLETE_FIELDS, ownership_pct: 10, guarantee_limitation_type: "max_liability", limit_max_payment: 50_000 },
      },
    ],
  });
  assert.equal(result.is_complete, true);
});

test("buildForm148: no signers -> is_complete=false", () => {
  const result = buildForm148({ signers: [] });
  assert.equal(result.is_complete, false);
  assert.deepEqual(result.signatures, []);
});
