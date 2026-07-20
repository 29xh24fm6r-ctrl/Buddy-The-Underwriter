import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm4506c } from "@/lib/sba/forms/form4506c/build";

const COMPLETE_SIGNER_FIELDS = {
  taxpayer_first_name: "Jane",
  taxpayer_last_name: "Doe",
  taxpayer_id: "on_file",
  current_address_street: "1 Main St",
  current_address_city: "Austin",
  current_address_state: "TX",
  current_address_zip: "78701",
  tax_form_number_line6: "1040",
  transcript_type_return: true,
  wants_wage_income_transcript: true,
  tax_periods: ["12/31/2023", "12/31/2024"],
  signer_print_name: "Jane Doe",
};

const COMPLETE_THIRD_PARTY = { client_name: "First National Bank" };

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

test("buildForm4506c: missing third-party client name -> flagged, is_complete=false", () => {
  const result = buildForm4506c({
    signers: [{ ownership_entity_id: "o1", fields: COMPLETE_SIGNER_FIELDS }],
    thirdParty: { client_name: null },
  });
  assert.equal(result.is_complete, false);
  assert.ok(result.missing.third_party.includes("client_name"));
});

test("buildForm4506c: no signers -> is_complete=false even with complete third party", () => {
  const result = buildForm4506c({ signers: [], thirdParty: COMPLETE_THIRD_PARTY });
  assert.equal(result.is_complete, false);
  assert.deepEqual(result.signatures, []);
});
