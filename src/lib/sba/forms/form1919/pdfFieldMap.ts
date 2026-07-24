/**
 * Real AcroForm field names for SBA Form 1919, extracted from
 * docs/sba-forms/1919-fields.json (dumped via pdf-lib from a
 * user-supplied copy of the current-revision PDF; every mapping below
 * was confirmed against that field's own /TU tooltip, which on this PDF
 * is a full instructional sentence — e.g. "OC" -> "If the Applicant is
 * an Operating Company (OC), please check this box..." — so confidence
 * here is high, not inferred from the cryptic field name alone).
 *
 * Unlike Form 912's yes/no questions (a single PDFRadioGroup per
 * question), 1919's are two independent PDFCheckBox fields per question
 * (q1Yes / q1No) — checking one doesn't automatically uncheck the other,
 * so render.ts must explicitly check the answered box and uncheck its
 * pair.
 *
 * Deliberately NOT mapped — signer-ceremony fields: "repSig" (signature),
 * "sigDate" (signed at signing time, not pre-filled), "q4Init" (a
 * signer-initial acknowledgment block for Q4, not a data field).
 */

export const FORM_1919_SECTION_I_TEXT_FIELDS: Record<string, string> = {
  applicant_legal_name: "applicantname",
  operating_business_name: "operatingnbusname", // if EPC is checked
  applicant_dba: "dba",
  applicant_ein: "busTIN",
  applicant_naics: "PrimarIndustry",
  applicant_phone: "busphone",
  unique_entity_id: "UniqueEntityID",
  applicant_year_founded: "yearbeginoperations",
  entity_other_description: "entityother", // if entity type "Other" is checked
  special_ownership_type_other: "specOwnTypeOther", // if special ownership type "Other" is checked
  applicant_address: "busAddr", // combined street/city/state/zip
  project_address: "projAddr", // combined street/city/state/zip
  poc_name: "pocName",
  poc_email: "pocEmail",
  existing_employees: "existEmp",
  jobs_retained: "fteJobs",
  jobs_created: "fteCreate",
  debt_refinance_amount: "debtAmt",
  purchase_or_construction_amount: "purchAmt",
  equipment_amount: "EquipAmt",
  working_capital_amount: "capitalAmt",
  business_acquisition_amount: "busAcqAmt",
  other_purpose_1_amount: "otherAmt1",
  other_purpose_1_description: "other1spec",
  other_purpose_2_amount: "otherAmt2",
  other_purpose_2_description: "other2spec",
  inventory_amount: "invAmt",
};

/** Up to 5 owners listed on Section I's ownership roster (name/title/%/TIN/home address). */
export const FORM_1919_ROSTER_FIELDS: Array<{ name: string; title: string; percentage: string; tin: string; homeAddress: string }> = [
  { name: "ownName1", title: "ownTitle1", percentage: "ownPerc1", tin: "ownTin1", homeAddress: "ownHome1" },
  { name: "ownName2", title: "ownTitle2", percentage: "ownPerc2", tin: "ownTin2", homeAddress: "ownHome2" },
  { name: "ownName3", title: "ownTitle3", percentage: "ownPerc3", tin: "ownTin3", homeAddress: "ownHome3" },
  { name: "ownName4", title: "ownTitle4", percentage: "ownPerc4", tin: "ownTin4", homeAddress: "ownHome4" },
  { name: "ownName5", title: "ownTitle5", percentage: "ownPerc5", tin: "ownTin5", homeAddress: "ownHome5" },
];

export const FORM_1919_SECTION_I_CHECKBOX_FIELDS: Record<string, string> = {
  is_operating_company: "OC",
  is_eligible_passive_company: "EPC",
  entity_type_sole_prop: "soleprop",
  entity_type_partnership: "partnership",
  entity_type_c_corp: "ccorp",
  entity_type_s_corp: "scorp",
  entity_type_llc: "llc",
  entity_type_other: "etother",
  special_ownership_esop: "ownESOP",
  special_ownership_401k: "own401k",
  special_ownership_cooperative: "ownCooperative",
  special_ownership_tribal: "ownNATribe",
  special_ownership_other: "ownOther",
  purpose_purchase_or_construction: "purchConstr",
  purpose_equipment: "purpEquip",
  purpose_working_capital: "workCap",
  purpose_business_acquisition: "busAcq",
  purpose_other_1: "purpOther1",
  purpose_other_2: "purpOther2",
  purpose_inventory: "purpInv",
  purpose_debt_refinance: "debtRef",
};

export const FORM_1919_SECTION_II_TEXT_FIELDS: Record<string, string> = {
  full_name: "ownName",
  position: "ownPos",
  export_sales_total: "expSalesTot",
  export_country_1: "expCtry1",
  export_country_2: "expCtry2",
  export_country_3: "expCtry3",
};

export const FORM_1919_VETERAN_CHECKBOX_FIELDS: Record<string, string> = {
  not_veteran: "statNonVet",
  veteran: "statVet",
  service_disabled_veteran: "statVetD",
  veterans_spouse: "statVetSp",
  not_disclosed: "statND",
};

export const FORM_1919_SEX_CHECKBOX_FIELDS: Record<string, string> = {
  male: "male",
  female: "female",
};

export const FORM_1919_RACE_CHECKBOX_FIELDS: Record<string, string> = {
  american_indian_or_alaska_native: "raceAIAN",
  asian: "raceAsian",
  black_or_african_american: "raceBAA",
  native_hawaiian_or_pacific_islander: "raceNHPI",
  white: "raceWhite",
  not_disclosed: "raceND",
};

export const FORM_1919_ETHNICITY_CHECKBOX_FIELDS: Record<string, string> = {
  hispanic_or_latino: "ethHisp",
  not_hispanic_or_latino: "ethNot",
  not_disclosed: "ethND",
};

/** The 13 real yes/no questions — each a Yes/No CheckBox pair, not a RadioGroup. */
export const FORM_1919_YES_NO_QUESTIONS: Record<string, { yes: string; no: string }> = {
  debarred_ineligible_or_bankrupt: { yes: "q1Yes", no: "q1No" },
  defaulted_or_delinquent_gov_loan: { yes: "q2Yes", no: "q2No" },
  owns_other_business: { yes: "q3Yes", no: "q3No" },
  incarcerated_or_indicted_financial_crime: { yes: "q4Yes", no: "q4No" },
  // q5Yes/q5No is the export gate, not a fee question — see fields.ts's
  // comment on has_export_sales for how a visual fill-test caught this.
  has_export_sales: { yes: "q5Yes", no: "q5No" },
  fee_paid_to_lender_or_broker: { yes: "q6Yes", no: "q6No" },
  restricted_revenue_source: { yes: "q7Yes", no: "q7No" },
  sba_employee_conflict: { yes: "q8Yes", no: "q8No" },
  former_sba_employee_conflict: { yes: "q9Yes", no: "q9No" },
  congress_legislative_judicial_conflict: { yes: "q10Yes", no: "q10No" },
  federal_employee_or_military_conflict: { yes: "q11Yes", no: "q11No" },
  score_or_advisory_council_member: { yes: "q12Yes", no: "q12No" },
  legal_action_pending: { yes: "q13Yes", no: "q13No" },
};

export const FORM_1919_SIGNATURE_TEXT_FIELDS: Record<string, string> = {
  rep_name: "repName",
  rep_title: "repTitle",
};
