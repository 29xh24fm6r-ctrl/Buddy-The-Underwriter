import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForm1244 } from "@/lib/sba/forms/form1244/build";

const COMPLETE_SECTION_I = {
  applicant_legal_name: "Acme Manufacturing LLC",
  applicant_address: "1 Main St, Austin, TX 78701",
  applicant_legal_structure: "llc",
  applicant_tax_id: "12-3456789",
  applicant_contact_name: "Jane Doe",
  applicant_email: "jane@acme.example",
  applicant_phone: "512-555-0100",
  type_of_business: "Metal fabrication",
  existing_employee_count: 12,
  loan_amount_required: 1_800_000,
  loan_purpose: "Purchase and renovate manufacturing facility",
  has_affiliates: false,
  obtained_direct_or_guaranteed_loan: false,
  prior_application_submitted: false,
  ever_bankrupt: false,
  pending_lawsuits: false,
};

const COMPLETE_PERSON_FIELDS = {
  full_name: "Jane Doe",
  is_us_citizen: true,
  place_of_birth: "Austin, TX",
  date_of_birth: "1980-01-01",
  full_ssn: "on_file",
  phone: "512-555-0100",
  home_address: "1 Main St, Austin, TX 78701",
  sba_loan_entity_interest: false,
  subject_to_indictment: false,
  arrested_6mo: false,
  convicted_diversion_or_parole: false,
  suspended_debarred_ineligible: false,
};

const BASE_INPUT = {
  isEligiblePassiveCompany: false,
  applicantOwnerRoster: [],
  ocOwnerRoster: [],
};

test("buildForm1244: fully complete sectionI + sectionII -> is_complete=true", () => {
  const result = buildForm1244({
    ...BASE_INPUT,
    sectionI: COMPLETE_SECTION_I,
    sectionII: [{ ownership_entity_id: "o1", fields: COMPLETE_PERSON_FIELDS }],
  });
  assert.equal(result.is_complete, true);
  assert.equal(result.missing.section_i.length, 0);
});

test("buildForm1244: missing applicant contact -> flagged in section_i missing", () => {
  const result = buildForm1244({
    ...BASE_INPUT,
    sectionI: { ...COMPLETE_SECTION_I, applicant_contact_name: null, applicant_email: null },
    sectionII: [],
  });
  assert.equal(result.is_complete, false);
  assert.ok(result.missing.section_i.includes("applicant_contact_name"));
  assert.ok(result.missing.section_i.includes("applicant_email"));
});

test("buildForm1244: isEligiblePassiveCompany=true requires Operating Company legal name", () => {
  const result = buildForm1244({
    ...BASE_INPUT,
    isEligiblePassiveCompany: true,
    sectionI: COMPLETE_SECTION_I,
    sectionII: [],
  });
  assert.equal(result.is_complete, false);
  assert.ok(result.missing.section_i.includes("oc_legal_name"));
});

test("buildForm1244: isEligiblePassiveCompany=true with OC fields present -> is_complete=true", () => {
  const result = buildForm1244({
    ...BASE_INPUT,
    isEligiblePassiveCompany: true,
    sectionI: {
      ...COMPLETE_SECTION_I,
      oc_legal_name: "Acme Real Estate Holdings LLC",
      oc_address: "1 Main St, Austin, TX 78701",
      oc_dba: null,
      oc_legal_structure: "llc",
      oc_tax_id: "98-7654321",
      oc_duns_number: null,
      oc_contact_name: "Jane Doe",
      oc_email: "jane@acme.example",
      oc_phone: "512-555-0100",
      oc_website: null,
    },
    sectionII: [],
  });
  assert.equal(result.is_complete, true, JSON.stringify(result.missing.section_i));
});

test("buildForm1244: sectionII person with subject_to_indictment=true -> triggers_form_912=true", () => {
  const result = buildForm1244({
    ...BASE_INPUT,
    sectionI: COMPLETE_SECTION_I,
    sectionII: [{ ownership_entity_id: "o1", fields: { ...COMPLETE_PERSON_FIELDS, subject_to_indictment: true } }],
  });
  assert.equal(result.triggers_form_912, true);
});

test("buildForm1244: all sectionII answers 'no' -> triggers_form_912=false", () => {
  const result = buildForm1244({
    ...BASE_INPUT,
    sectionI: COMPLETE_SECTION_I,
    sectionII: [{ ownership_entity_id: "o1", fields: COMPLETE_PERSON_FIELDS }],
  });
  assert.equal(result.triggers_form_912, false);
});
