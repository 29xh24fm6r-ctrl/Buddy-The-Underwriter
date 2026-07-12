import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm912 } from "@/lib/sba/forms/form912/build";

const COMPLETE_PERSON_FIELDS = {
  full_name: "Jane Doe",
  date_of_birth: "1980-01-01",
  place_of_birth: "Austin, TX",
  ssn_last4: "1234",
  citizenship_status: "us_citizen",
  current_address_street: "1 Main St",
  current_address_city: "Austin",
  current_address_state: "TX",
  current_address_zip: "78701",
  residence_history_5yr: "Austin, TX since 2015",
  arrest_or_charge_explanation: "N/A",
  conviction_explanation: "N/A",
};

test("buildForm912: not applicable -> { applicable: false }, no missing-field noise", () => {
  const result = buildForm912({ applicable: false, persons: [] });
  assert.equal(result.applicable, false);
  assert.deepEqual(result, { form: "912", applicable: false });
});

test("buildForm912: applicable, fully complete person -> is_complete=true", () => {
  const result = buildForm912({ applicable: true, persons: [{ ownership_entity_id: "o1", fields: COMPLETE_PERSON_FIELDS }] });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, true);
  assert.equal(result.missing[0].missing.length, 0);
});

test("buildForm912: applicable, missing conviction_explanation -> flagged, is_complete=false", () => {
  const result = buildForm912({
    applicable: true,
    persons: [{ ownership_entity_id: "o1", fields: { ...COMPLETE_PERSON_FIELDS, conviction_explanation: null } }],
  });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, false);
  assert.ok(result.missing[0].missing.includes("conviction_explanation"));
});

test("buildForm912: applicable but no persons -> is_complete=false", () => {
  const result = buildForm912({ applicable: true, persons: [] });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, false);
  assert.deepEqual(result.signatures, []);
});
