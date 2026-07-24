import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm413, type Form413Input } from "@/lib/sba/forms/form413/build";

function isoDate(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
}

test("empty input -> no signers, is_complete = true (nothing to check)", () => {
  const result = buildForm413({ signers: [] });
  assert.equal(result.missing.length, 0);
  assert.equal(result.is_complete, true);
});

test("signer with no fields -> all required fields missing", () => {
  const input: Form413Input = { signers: [{ ownership_entity_id: "p1", fields: {} }] };
  const result = buildForm413(input);
  assert.ok(result.missing[0].missing.includes("full_name"));
  assert.ok(result.missing[0].missing.includes("asset_total"));
  assert.equal(result.is_complete, false);
});

test("partial signer -> some required present, still incomplete", () => {
  const input: Form413Input = {
    signers: [{ ownership_entity_id: "p1", fields: { full_name: "Jane Doe", ssn_last4: "1234" } }],
  };
  const result = buildForm413(input);
  assert.ok(!result.missing[0].missing.includes("full_name"));
  assert.ok(result.missing[0].missing.includes("asset_total"));
  assert.equal(result.is_complete, false);
});

test("complete signer, signed recently, no spouse -> is_complete = true", () => {
  const input: Form413Input = {
    signers: [
      {
        ownership_entity_id: "p1",
        fields: {
          full_name: "Jane Doe",
          address_street: "1 Main St",
          address_city: "Springfield",
          address_state: "IL",
          address_zip: "62701",
          home_phone: "555-1234",
          full_ssn: "on_file",
          date_of_birth: "1980-01-01",
          business_name: "Acme LLC",
          asset_cash_on_hand_and_in_banks: 10000,
          asset_real_estate: 200000,
          asset_total: 210000,
          liability_mortgages_on_real_estate: 150000,
          liability_total: 150000,
          net_worth: 60000,
          income_salary: 80000,
          signed_at: isoDate(1),
          has_spouse: false,
        },
      },
    ],
  };
  const result = buildForm413(input);
  assert.equal(result.missing[0].missing.length, 0);
  assert.equal(result.signatures[0].needs_resignature, false);
  assert.equal(result.is_complete, true);
});

test("spouse fields present when has_spouse = true", () => {
  const input: Form413Input = {
    signers: [
      {
        ownership_entity_id: "p1",
        fields: { has_spouse: true, spouse_full_name: "John Doe", spouse_signed_at: isoDate(1) },
      },
    ],
  };
  const result = buildForm413(input);
  assert.equal(input.signers[0].fields.spouse_full_name, "John Doe");
  // has_spouse itself is a required field and is present -> not in missing
  assert.ok(!result.missing[0].missing.includes("has_spouse"));
});

test("signature older than 90 days -> needs_resignature = true, has_valid_signature stays false", () => {
  const input: Form413Input = {
    signers: [{ ownership_entity_id: "p1", fields: { signed_at: isoDate(100) } }],
  };
  const result = buildForm413(input);
  assert.equal(result.signatures[0].needs_resignature, true);
  assert.equal(result.signatures[0].has_valid_signature, false);
});

test("signature 80 days old (10 days from expiry) -> needs_resignature = true (within 14d warning window)", () => {
  const input: Form413Input = {
    signers: [{ ownership_entity_id: "p1", fields: { signed_at: isoDate(80) } }],
  };
  const result = buildForm413(input);
  assert.equal(result.signatures[0].needs_resignature, true);
});

test("signature 10 days old -> needs_resignature = false, expires_at ~80 days out", () => {
  const input: Form413Input = {
    signers: [{ ownership_entity_id: "p1", fields: { signed_at: isoDate(10) } }],
  };
  const result = buildForm413(input);
  assert.equal(result.signatures[0].needs_resignature, false);
  assert.ok(result.signatures[0].expires_at);
});

test("no signed_at -> needs_resignature = true (unsigned counts as needing signature)", () => {
  const input: Form413Input = {
    signers: [{ ownership_entity_id: "p1", fields: {} }],
  };
  const result = buildForm413(input);
  assert.equal(result.signatures[0].signed_at, null);
  assert.equal(result.signatures[0].needs_resignature, true);
});
