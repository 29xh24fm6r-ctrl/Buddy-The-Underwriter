import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm4506c } from "@/lib/sba/forms/form4506c/build";

const COMPLETE_SIGNER_FIELDS = {
  taxpayer_name: "Jane Doe",
  taxpayer_id: "1234",
  current_address_street: "1 Main St",
  current_address_city: "Austin",
  current_address_state: "TX",
  current_address_zip: "78701",
  transcript_type_return: true,
  transcript_type_account: true,
  transcript_type_wage_income: true,
  transcript_type_verification_nonfiling: false,
  tax_form_numbers: "1040",
  tax_years: "2023,2024",
};

const COMPLETE_THIRD_PARTY = { recipient_name: "First National Bank" };

test("buildForm4506c: fully complete signer + third party -> is_complete=true", () => {
  const result = buildForm4506c({
    signers: [{ ownership_entity_id: "o1", fields: COMPLETE_SIGNER_FIELDS }],
    thirdParty: COMPLETE_THIRD_PARTY,
  });
  assert.equal(result.is_complete, true);
  assert.equal(result.missing.signers[0].missing.length, 0);
  assert.equal(result.missing.third_party.length, 0);
});

test("buildForm4506c: missing taxpayer_id -> flagged in signer's missing array, is_complete=false", () => {
  const result = buildForm4506c({
    signers: [{ ownership_entity_id: "o1", fields: { ...COMPLETE_SIGNER_FIELDS, taxpayer_id: null } }],
    thirdParty: COMPLETE_THIRD_PARTY,
  });
  assert.equal(result.is_complete, false);
  assert.ok(result.missing.signers[0].missing.includes("taxpayer_id"));
});

test("buildForm4506c: missing third-party recipient -> flagged, is_complete=false", () => {
  const result = buildForm4506c({
    signers: [{ ownership_entity_id: "o1", fields: COMPLETE_SIGNER_FIELDS }],
    thirdParty: { recipient_name: null },
  });
  assert.equal(result.is_complete, false);
  assert.ok(result.missing.third_party.includes("recipient_name"));
});

test("buildForm4506c: no signers -> is_complete=false even with complete third party", () => {
  const result = buildForm4506c({ signers: [], thirdParty: COMPLETE_THIRD_PARTY });
  assert.equal(result.is_complete, false);
  assert.deepEqual(result.signatures, []);
});
