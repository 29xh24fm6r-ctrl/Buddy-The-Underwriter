import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm601 } from "@/lib/sba/forms/form601/build";

const COMPLETE_FIELDS = {
  borrower_legal_name: "Acme LLC",
  lender_name: "First National Bank",
  project_address_street: "200 Industrial Blvd",
  project_address_city: "Austin",
  project_address_state: "TX",
  project_address_zip: "78702",
  construction_amount: 50_000,
  compliance_certification_acknowledged: true,
};

test("buildForm601: not applicable -> { applicable: false }", () => {
  const result = buildForm601({ applicable: false, fields: {}, borrowerOwnershipEntityId: null });
  assert.deepEqual(result, { form: "601", applicable: false });
});

test("buildForm601: applicable, fully complete + borrower signer resolved -> is_complete=true", () => {
  const result = buildForm601({ applicable: true, fields: COMPLETE_FIELDS, borrowerOwnershipEntityId: "o1" });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, true);
  assert.equal(result.missing.length, 0);
});

test("buildForm601: applicable but missing certification acknowledgment -> flagged, is_complete=false", () => {
  const result = buildForm601({
    applicable: true,
    fields: { ...COMPLETE_FIELDS, compliance_certification_acknowledged: null },
    borrowerOwnershipEntityId: "o1",
  });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, false);
  assert.ok(result.missing.includes("compliance_certification_acknowledged"));
});
