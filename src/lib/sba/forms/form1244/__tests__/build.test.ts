import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm1244 } from "@/lib/sba/forms/form1244/build";

const COMPLETE_SECTION_I = {
  applicant_legal_name: "Acme Manufacturing LLC",
  applicant_ein: "12-3456789",
  applicant_address_street: "1 Main St",
  applicant_address_city: "Austin",
  applicant_address_state: "TX",
  applicant_address_zip: "78701",
  applicant_phone: "512-555-0100",
  applicant_business_type: "llc",
  applicant_naics: "332710",
  applicant_employee_count: 12,
  applicant_year_founded: 2015,
  project_address_street: "200 Industrial Blvd",
  project_address_city: "Austin",
  project_address_state: "TX",
  project_address_zip: "78702",
  total_project_cost: 2_000_000,
  third_party_lender_amount: 1_000_000,
  cdc_debenture_amount: 800_000,
  borrower_contribution_amount: 200_000,
  occupancy_percentage: 100,
  creates_or_retains_jobs: true,
  meets_public_policy_goal: false,
  includes_debt_refinance: false,
  is_franchise_deal: false,
  has_other_sba_application_pending: false,
  has_been_in_bankruptcy_pending: false,
  has_pending_lawsuits: false,
  is_engaged_in_lobbying: false,
};

const COMPLETE_PERSON_FIELDS = {
  full_name: "Jane Doe",
  ssn_last4: "1234",
  date_of_birth: "1980-01-01",
  place_of_birth: "Austin, TX",
  is_us_citizen: true,
  is_us_national: false,
  is_lpr: false,
  home_address_street: "1 Main St",
  home_address_city: "Austin",
  home_address_state: "TX",
  home_address_zip: "78701",
  is_employee_of_us_government: false,
  has_other_government_employment: false,
  has_been_arrested_or_charged_in_6mo: false,
  has_been_convicted_or_pleaded: false,
  has_pending_criminal_charges: false,
  is_subject_to_indictment: false,
  has_paroled_or_probation: false,
};

test("buildForm1244: fully complete sectionI + sectionII -> is_complete=true", () => {
  const result = buildForm1244({
    sectionI: COMPLETE_SECTION_I,
    sectionII: [{ ownership_entity_id: "o1", fields: COMPLETE_PERSON_FIELDS }],
    sectionIII: [],
  });
  assert.equal(result.is_complete, true);
  assert.equal(result.missing.section_i.length, 0);
});

test("buildForm1244: missing 50/40/10 split fields -> flagged in section_i missing", () => {
  const result = buildForm1244({
    sectionI: { ...COMPLETE_SECTION_I, cdc_debenture_amount: null, third_party_lender_amount: null },
    sectionII: [],
    sectionIII: [],
  });
  assert.equal(result.is_complete, false);
  assert.ok(result.missing.section_i.includes("cdc_debenture_amount"));
  assert.ok(result.missing.section_i.includes("third_party_lender_amount"));
});

test("buildForm1244: sectionII person with has_been_convicted_or_pleaded=true -> triggers_form_912=true", () => {
  const result = buildForm1244({
    sectionI: COMPLETE_SECTION_I,
    sectionII: [{ ownership_entity_id: "o1", fields: { ...COMPLETE_PERSON_FIELDS, has_been_convicted_or_pleaded: true } }],
    sectionIII: [],
  });
  assert.equal(result.triggers_form_912, true);
});

test("buildForm1244: all sectionII answers 'no' -> triggers_form_912=false", () => {
  const result = buildForm1244({
    sectionI: COMPLETE_SECTION_I,
    sectionII: [{ ownership_entity_id: "o1", fields: COMPLETE_PERSON_FIELDS }],
    sectionIII: [],
  });
  assert.equal(result.triggers_form_912, false);
});
