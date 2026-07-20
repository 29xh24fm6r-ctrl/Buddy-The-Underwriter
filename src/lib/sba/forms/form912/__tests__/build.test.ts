import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm912 } from "@/lib/sba/forms/form912/build";

const COMPLETE_PERSON_FIELDS = {
  business_name_address_email: "Acme LLC; 1 Main St, Austin, TX 78701; owner@acme.com",
  full_name: "Jane Doe",
  ownership_percentage: 25,
  full_ssn: "on_file",
  date_of_birth: "1980-01-01",
  place_of_birth: "Austin, TX",
  is_us_citizen: true,
  current_address_street: "1 Main St",
  current_address_city: "Austin",
  current_address_state: "TX",
  current_address_zip: "78701",
  incarcerated_or_indicted_financial_crime: false,
  riot_related_conviction_past_year: false,
  delinquent_child_support_60days: false,
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

test("buildForm912: applicable, missing full_ssn -> flagged, is_complete=false", () => {
  const result = buildForm912({
    applicable: true,
    persons: [{ ownership_entity_id: "o1", fields: { ...COMPLETE_PERSON_FIELDS, full_ssn: null } }],
  });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, false);
  assert.ok(result.missing[0].missing.includes("full_ssn"));
});

test("buildForm912: applicable, missing one of the 3 real compliance questions -> flagged", () => {
  const result = buildForm912({
    applicable: true,
    persons: [{ ownership_entity_id: "o1", fields: { ...COMPLETE_PERSON_FIELDS, delinquent_child_support_60days: null } }],
  });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, false);
  assert.ok(result.missing[0].missing.includes("delinquent_child_support_60days"));
});

test("buildForm912: applicable but no persons -> is_complete=false", () => {
  const result = buildForm912({ applicable: true, persons: [] });
  assert.equal(result.applicable, true);
  if (!result.applicable) return;
  assert.equal(result.is_complete, false);
  assert.deepEqual(result.signatures, []);
});
