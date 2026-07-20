import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm1919, type Form1919Input } from "@/lib/sba/forms/form1919/build";

function emptyInput(): Form1919Input {
  return { sectionI: {}, sectionII: [], sectionIII: [], ownerRoster: [] };
}

const COMPLETE_PERSON_FIELDS = {
  full_name: "Jane Doe",
  position: "Managing Member",
  full_ssn: "on_file",
  date_of_birth: "1980-01-01",
  place_of_birth: "Chicago, IL",
  is_us_citizen: true,
  is_us_national: false,
  is_lpr: false,
  home_address_street: "2 Elm St",
  home_address_city: "Springfield",
  home_address_state: "IL",
  home_address_zip: "62701",
  debarred_ineligible_or_bankrupt: false,
  defaulted_or_delinquent_gov_loan: false,
  owns_other_business: false,
  incarcerated_or_indicted_financial_crime: false,
  has_export_sales: false,
  fee_paid_to_lender_or_broker: false,
  restricted_revenue_source: false,
  sba_employee_conflict: false,
  former_sba_employee_conflict: false,
  congress_legislative_judicial_conflict: false,
  federal_employee_or_military_conflict: false,
  score_or_advisory_council_member: false,
  legal_action_pending: false,
};

test("empty input -> all required missing in section I, no is_complete", () => {
  const result = buildForm1919(emptyInput());
  assert.ok(result.missing.section_i.includes("applicant_legal_name"));
  assert.ok(result.missing.section_i.includes("loan_amount"));
  assert.equal(result.is_complete, false);
  assert.equal(result.triggers_form_912, false);
});

test("section I complete + 1 fully populated person + 0 entities -> is_complete = true", () => {
  const input: Form1919Input = {
    sectionI: {
      applicant_legal_name: "Acme LLC",
      applicant_dba: null,
      applicant_ein: "12-3456789",
      applicant_address_street: "1 Main St",
      applicant_address_city: "Springfield",
      applicant_address_state: "IL",
      applicant_address_zip: "62701",
      applicant_phone: "555-1234",
      applicant_business_type: "LLC",
      applicant_naics: "722511",
      applicant_employee_count: 10,
      applicant_year_founded: 2015,
      poc_name: "Jane Doe",
      poc_email: "jane@acme.com",
      loan_amount: 500000,
      loan_program: "sba_7a_standard",
      is_franchise_deal: false,
    },
    sectionII: [{ ownership_entity_id: "p1", fields: COMPLETE_PERSON_FIELDS }],
    sectionIII: [],
    ownerRoster: [],
  };

  const result = buildForm1919(input);
  assert.equal(result.missing.section_i.length, 0);
  assert.equal(result.missing.section_ii[0].missing.length, 0);
  assert.equal(result.is_complete, true);
  assert.equal(result.triggers_form_912, false);
});

test("person with incarcerated_or_indicted_financial_crime=true -> triggers_form_912 = true", () => {
  const input = emptyInput();
  input.sectionII.push({
    ownership_entity_id: "p1",
    fields: { incarcerated_or_indicted_financial_crime: true },
  });
  const result = buildForm1919(input);
  assert.equal(result.triggers_form_912, true);
});

test("multiple persons, one missing SSN -> section_ii identifies which person via ownership_entity_id", () => {
  const input = emptyInput();
  input.sectionII.push(
    { ownership_entity_id: "p1", fields: { full_ssn: "on_file" } },
    { ownership_entity_id: "p2", fields: {} },
  );
  const result = buildForm1919(input);
  const p1 = result.missing.section_ii.find((p) => p.ownership_entity_id === "p1");
  const p2 = result.missing.section_ii.find((p) => p.ownership_entity_id === "p2");
  assert.ok(!p1?.missing.includes("full_ssn"));
  assert.ok(p2?.missing.includes("full_ssn"));
});

test("section III entity missing EIN -> section_iii[*].missing includes 'ein'", () => {
  const input = emptyInput();
  input.sectionIII.push({
    ownership_entity_id: "e1",
    fields: { legal_name: "Acme Holdco LLC" },
  });
  const result = buildForm1919(input);
  assert.ok(result.missing.section_iii[0].missing.includes("ein"));
});
