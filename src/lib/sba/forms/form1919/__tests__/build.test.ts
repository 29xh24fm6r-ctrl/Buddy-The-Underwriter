import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm1919, type Form1919Input } from "@/lib/sba/forms/form1919/build";

function emptyInput(): Form1919Input {
  return { sectionI: {}, sectionII: [], sectionIII: [] };
}

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
      loan_amount: 500000,
      loan_program: "sba_7a_standard",
      use_of_proceeds_summary: "Working capital",
      is_franchise_deal: false,
      has_other_sba_application_pending: false,
      has_been_in_bankruptcy_pending: false,
      has_pending_lawsuits: false,
      is_engaged_in_lobbying: false,
    },
    sectionII: [
      {
        ownership_entity_id: "p1",
        fields: {
          full_name: "Jane Doe",
          ssn_last4: "1234",
          date_of_birth: "1980-01-01",
          place_of_birth: "Chicago, IL",
          is_us_citizen: true,
          is_us_national: false,
          is_lpr: false,
          home_address_street: "2 Elm St",
          home_address_city: "Springfield",
          home_address_state: "IL",
          home_address_zip: "62701",
          is_employee_of_us_government: false,
          has_other_government_employment: false,
          has_been_arrested_or_charged_in_6mo: false,
          has_been_convicted_or_pleaded: false,
          has_pending_criminal_charges: false,
          is_subject_to_indictment: false,
          has_paroled_or_probation: false,
        },
      },
    ],
    sectionIII: [],
  };

  const result = buildForm1919(input);
  assert.equal(result.missing.section_i.length, 0);
  assert.equal(result.missing.section_ii[0].missing.length, 0);
  assert.equal(result.is_complete, true);
  assert.equal(result.triggers_form_912, false);
});

test("person with has_been_convicted_or_pleaded=true -> triggers_form_912 = true", () => {
  const input = emptyInput();
  input.sectionII.push({
    ownership_entity_id: "p1",
    fields: { has_been_convicted_or_pleaded: true },
  });
  const result = buildForm1919(input);
  assert.equal(result.triggers_form_912, true);
});

test("multiple persons, one missing SSN -> section_ii identifies which person via ownership_entity_id", () => {
  const input = emptyInput();
  input.sectionII.push(
    { ownership_entity_id: "p1", fields: { ssn_last4: "1234" } },
    { ownership_entity_id: "p2", fields: {} },
  );
  const result = buildForm1919(input);
  const p1 = result.missing.section_ii.find((p) => p.ownership_entity_id === "p1");
  const p2 = result.missing.section_ii.find((p) => p.ownership_entity_id === "p2");
  assert.ok(!p1?.missing.includes("ssn_last4"));
  assert.ok(p2?.missing.includes("ssn_last4"));
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
