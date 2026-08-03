/**
 * Real AcroForm field names for SBA Form 159, extracted from
 * docs/sba-forms/159-fields.json (dumped via pdf-lib from a user-supplied
 * copy of the current-revision PDF; each mapping below was confirmed
 * against that field's own /TU tooltip).
 *
 * Signature fields (PDFSignature) are deliberately NOT mapped — those are
 * filled during the SignWell ceremony, not by Buddy's pre-fill step.
 * Date/PrintName/Title fields adjacent to signatures are mapped so the
 * renderer can stamp the agent block at generation time; applicant and
 * lender blocks are left for the signing ceremony.
 */

export const FORM_159_TEXT_FIELDS: Record<string, string> = {
  sba_loan_name: "SBA Loan Name",
  sba_loan_number: "SBA Loan Number 10 digit number",
  sba_location_id: "SBA Location ID 67 digit number",
  sba_lender_legal_name: "SBA Lender Legal Name",
  agent_name: "Services Performed by Name of Agent",
  agent_contact_person: "Agent Contact Person",
  agent_address: "Agent Address",

  applicant_loan_packaging: "Amount Paid by ApplicantLoan packaging",
  lender_loan_packaging: "Amount Paid by SBA LenderLoan packaging",
  applicant_financial_prep: "Amount Paid by ApplicantFinancial statement preparation for loan application",
  lender_financial_prep: "Amount Paid by SBA LenderFinancial statement preparation for loan application",
  applicant_broker_referral: "Amount Paid by ApplicantBroker or Referral services",
  lender_broker_referral: "Amount Paid by SBA LenderBroker or Referral services",
  applicant_consultant: "Amount Paid by ApplicantConsultant services",
  lender_consultant: "Amount Paid by SBA LenderConsultant services",
  other_service_description: "Other_2",
  applicant_other: "Amount Paid by ApplicantOther",
  lender_other: "Amount Paid by SBA LenderOther",

  total_applicant: "Applicant",
  total_lender: "SBA Lender_2",

  tpl_fee_amount: "Amount of Fee",
  tpl_name: "TPL Name",
  tpl_address: "TPL Address",

  other_agent_type: "other type of agent",

  applicant_sig_date: "Date 1 mm/dd/yyyy",
  applicant_print_name: "Print Name",
  applicant_title: "Title",
  agent_sig_date: "Date 2 mm/dd/yyyy",
  agent_print_name: "Print Name_2",
  agent_title: "Title_2",
  lender_sig_date: "Date 3 mm/dd/yyyy",
  lender_print_name: "Print Name_3",
  lender_title: "Title_3",
};

export const FORM_159_CHECKBOX_FIELDS: Record<string, string> = {
  loan_type_7a: "7a loan",
  loan_type_504: "504 loan",
  agent_type_sba_lender: "SBA Lender",
  agent_type_independent_loan_packager: "Independent Loan Packager",
  agent_type_referral_broker: "Referral AgentBroker",
  agent_type_consultant: "Consultant",
  agent_type_accountant: "Accountant preparing financial",
  agent_type_tpl: "Third Party Lender TPL",
  agent_type_other: "Other",
  itemization_attached: "Itemization and supporting documentation is attached",
  cdc_received_tpl_referral_fee: "CDC received referral fee from a TPL",
};

/**
 * Maps `Sba159FeeLine.fee_type` → the PDF grid row key prefix used in
 * FORM_159_TEXT_FIELDS. Each fee_type has two columns (applicant / lender).
 */
export const FEE_TYPE_TO_GRID_ROW: Record<string, { applicant: keyof typeof FORM_159_TEXT_FIELDS; lender: keyof typeof FORM_159_TEXT_FIELDS }> = {
  borrower_packaging: { applicant: "applicant_loan_packaging", lender: "lender_loan_packaging" },
  financial_preparation: { applicant: "applicant_financial_prep", lender: "lender_financial_prep" },
  lender_referral: { applicant: "applicant_broker_referral", lender: "lender_broker_referral" },
  consultant: { applicant: "applicant_consultant", lender: "lender_consultant" },
};
