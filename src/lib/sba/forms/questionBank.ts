/**
 * §3.A — Question bank: the formal mapping from every
 * BorrowerFieldEntry to a borrower-facing question with input type,
 * grouping, conditional-display rules, and sensitivity flags.
 *
 * The concierge ranker (borrowerConversation.ts) already knows WHAT to
 * ask next; this module tells the intake UI HOW to ask it: input widget,
 * placeholder, validation, and which section/group it belongs to.
 *
 * Character questions (sensitive: true, type: boolean, entityScope: owner)
 * carry `requiresExplicitConfirmation: true` — an LLM must not infer a
 * criminal-history answer from conversational text; only an explicit
 * borrower action confirms (spec constraint §3.C).
 */

import {
  BORROWER_FIELD_REGISTRY,
  fieldsForForm,
  requiredFieldsForForm,
  type BorrowerFieldEntry,
  type BorrowerFieldEntityScope,
} from "@/lib/sba/forms/borrowerFieldRegistry";

// ── Types ─────────────────────────────────────────────────────────────

export type InputType =
  | "text"
  | "number"
  | "currency"
  | "boolean"
  | "date"
  | "phone"
  | "email"
  | "ssn"
  | "ein"
  | "select"
  | "textarea";

export type QuestionGroup =
  | "business_identity"
  | "business_address"
  | "business_contacts"
  | "business_details"
  | "owner_identity"
  | "owner_address"
  | "owner_demographics"
  | "owner_character_1919"
  | "owner_character_1244"
  | "owner_character_912"
  | "owner_guarantee"
  | "owner_pfs_assets"
  | "owner_pfs_liabilities"
  | "owner_pfs_income"
  | "owner_pfs_narratives"
  | "owner_spouse"
  | "loan_basic"
  | "loan_operating_company"
  | "loan_standby"
  | "loan_contractor"
  | "loan_tax"
  | "entity_identity";

export type FormQuestion = {
  key: string;
  registryEntry: BorrowerFieldEntry;
  question: string;
  inputType: InputType;
  group: QuestionGroup;
  placeholder?: string;
  requiresExplicitConfirmation: boolean;
  requiresPiiVault: boolean;
  conditionalOn?: string;
};

// ── Character-question keys (§3.C constraint) ─────────────────────────
// These booleans require an explicit borrower action to confirm, never
// LLM inference from conversational text.

const CHARACTER_QUESTION_KEYS = new Set<string>([
  // Form 1919 Section II — 13 yes/no questions
  "debarred_ineligible_or_bankrupt",
  "defaulted_or_delinquent_gov_loan",
  "owns_other_business",
  "incarcerated_or_indicted_financial_crime",
  "has_export_sales",
  "fee_paid_to_lender_or_broker",
  "restricted_revenue_source",
  "sba_employee_conflict",
  "former_sba_employee_conflict",
  "congress_legislative_judicial_conflict",
  "federal_employee_or_military_conflict",
  "score_or_advisory_council_member",
  "legal_action_pending",
  // Form 1244 Section Two — 5 questions
  "subject_to_indictment",
  "arrested_or_charged_6mo",
  "convicted_diversion_or_parole",
  "suspended_debarred_ineligible",
  "sba_loan_entity_interest",
  // Form 912 — 3 questions
  "riot_related_conviction_past_year",
  "delinquent_child_support_60days",
]);

// ── PII vault keys ────────────────────────────────────────────────────
const PII_VAULT_KEYS = new Set(["full_ssn", "spouse_full_ssn"]);

// ── Question text overrides ───────────────────────────────────────────
// The registry's `label` is terse for ranker display; these are the
// full borrower-facing question texts.

const QUESTION_TEXT: Record<string, string> = {
  // Business identity
  legal_name: "What is the legal name of your business?",
  dba: "Does your business operate under a DBA (doing business as) name?",
  ein: "What is your business's Employer Identification Number (EIN)?",
  entity_type: "What type of business entity is this?",
  naics_code: "What is your primary industry NAICS code?",
  employee_count: "How many employees does your business have?",
  year_founded: "What year was your business founded?",
  unique_entity_id: "What is your SAM.gov Unique Entity ID (UEI)?",
  special_ownership_type: "Does your business have a special ownership type (ESOP, 401k, cooperative, etc.)?",

  // Business address
  address_street: "What is your business street address?",
  address_city: "What city is your business located in?",
  address_state: "What state is your business located in?",
  address_zip: "What is your business ZIP code?",
  phone: "What is your business phone number?",
  project_address_street: "What is the project address, if different from the business address?",

  // Business contacts & details (1244)
  duns_number: "What is your business DUNS number?",
  website: "What is your business website?",
  contact_name: "Who is the primary contact for this application?",
  contact_email: "What is the contact's email address?",
  type_of_business: "Briefly describe the type of business (e.g., restaurant, manufacturing).",
  has_affiliates: "Does your business have any affiliates?",
  obtained_direct_or_guaranteed_loan: "Have you ever obtained or applied for a direct or guaranteed government loan?",
  prior_application_submitted: "Has an application for this project been previously submitted to the SBA?",
  prior_cdc_lender_name_and_program: "If yes, what was the CDC/Lender name and loan program?",
  has_bankruptcy_history: "Is the business currently involved in or has it ever filed for bankruptcy?",
  has_pending_lawsuits: "Are there any pending lawsuits against the business?",

  // Owner identity
  full_name: "What is your full legal name?",
  ownership_pct: "What percentage of the business do you own?",
  title: "What is your title or role in the business?",
  ssn_last4: "What are the last 4 digits of your Social Security Number?",
  full_ssn: "What is your full Social Security Number?",
  date_of_birth: "What is your date of birth?",
  place_of_birth: "Where were you born (city and state, or foreign country)?",
  citizenship_status: "Are you a U.S. citizen?",
  principal_residence_in_us: "Is your principal residence in the United States?",
  alien_registration_number: "What is your alien registration number?",

  // Owner address
  home_address_street: "What is your home street address?",
  home_address_city: "What city do you live in?",
  home_address_state: "What state do you live in?",
  home_address_zip: "What is your home ZIP code?",
  home_phone: "What is your home or cell phone number?",
  business_phone: "What is your business phone number?",

  // Character questions — 1919 Section II
  debarred_ineligible_or_bankrupt: "Are you presently debarred, suspended, proposed for debarment, declared ineligible, or voluntarily excluded from participation in this transaction by any Federal department or agency, or presently involved in any bankruptcy?",
  defaulted_or_delinquent_gov_loan: "Are you presently delinquent or have you ever defaulted on a Federally assisted financing (SBA, FHA, VA, student loans, etc.)?",
  owns_other_business: "Are you (the Applicant business) or any owner of the Applicant an owner of any other business?",
  incarcerated_or_indicted_financial_crime: "Are you presently incarcerated, on probation or parole, or presently subject to an indictment, criminal information, arraignment, or other means by which formal criminal charges are brought in any jurisdiction, for any felony or any crime involving financial misconduct or a false statement?",
  has_export_sales: "Are any of the Applicant's products or services exported, or is this an Export Working Capital Program (EWCP) loan?",
  fee_paid_to_lender_or_broker: "Has any fee been paid or will any fee be paid to the Lender or a third party (broker, consultant, etc.) to assist in obtaining this loan?",
  restricted_revenue_source: "Does the Applicant business earn more than one-third of its gross annual revenue from legal gambling activities, or derive any of its gross annual revenue from lending activities, or earn more than one-third of its gross annual revenue from packaging SBA loans, or derive any revenue from activities of a prurient sexual nature?",
  sba_employee_conflict: "Is any owner of the Applicant business a current employee of SBA, or a member of the household of an SBA employee?",
  former_sba_employee_conflict: "Is the Applicant business or any owner associated with a former SBA employee who has been separated from SBA for less than one year?",
  congress_legislative_judicial_conflict: "Is any 10%+ owner, officer, or director (or household member) a member of Congress or an appointed official or employee of the legislative or judicial branch of the Federal Government?",
  federal_employee_or_military_conflict: "Is any 10%+ owner, officer, or director (or household member) a GS-13 or higher Federal employee, or military equivalent?",
  score_or_advisory_council_member: "Is any 10%+ owner, officer, or director (or household member) a member of a SCORE Advisory Board or volunteer, or a member of a Small Business Advisory Council?",
  legal_action_pending: "Is the Applicant, any owner, or an affiliate presently involved in any legal action (including divorce)?",

  // Character questions — 1244 Section Two
  subject_to_indictment: "Are you presently subject to an indictment, criminal information, arraignment, or other means by which formal criminal charges are brought?",
  arrested_or_charged_6mo: "Have you been arrested within the last 6 months for any criminal offense?",
  convicted_diversion_or_parole: "Have you ever been convicted, placed on pretrial diversion, or placed on any form of parole or probation (including probation before judgment) for any criminal offense other than a minor vehicle violation?",
  suspended_debarred_ineligible: "Are you presently suspended, debarred, proposed for debarment, declared ineligible, or voluntarily excluded from participation in any Federal program?",
  sba_loan_entity_interest: "Do you have ownership interest in any entity that has an existing SBA loan?",

  // Character questions — 912
  riot_related_conviction_past_year: "In the past year, have you been convicted of a criminal offense committed during and in connection with a riot or civil disorder or other declared disaster?",
  delinquent_child_support_60days: "Are you currently more than 60 days delinquent on any child support obligations?",

  // Owner demographics
  veteran_status: "What is your veteran status?",
  sex: "What is your sex?",
  race: "What is your race?",
  ethnicity: "What is your ethnicity?",

  // Owner — 1244 extras
  former_names_and_dates_used: "List any former names you have used and the dates they were used.",
  country_of_citizenship: "If not a U.S. citizen, what is your country of citizenship?",
  sba_loan_entity_interest_details: "Provide the SBA loan numbers and current status.",

  // Owner — 912 extras
  all_other_names_used: "List all other names you have used.",
  residence_history_5yr: "Provide your residence history for the last 5 years.",
  arrest_explanation: "Provide an explanation of any arrests or charges.",
  conviction_explanation: "Provide an explanation of any convictions or pleas.",
  indictment_explanation: "Provide an explanation of any pending indictments.",
  parole_explanation: "Provide an explanation of any parole or probation status.",
  prior_address_street: "What was your most recent prior address?",
  export_sales_total: "What is the estimated total export sales this loan will support?",
  export_country_1: "What is the principal export country?",

  // Guarantee
  guarantee_limitation_type: "What type of guarantee limitation applies?",
  guarantee_limit_balance_under: "Below what total amount owing is the guarantee released?",
  guarantee_limit_principal_under: "Below what principal balance is the guarantee released?",
  guarantee_limit_max_payment: "What is the maximum guarantor payment amount?",
  guarantee_limit_percent_payment: "What percentage of amounts owing applies?",
  guarantee_limit_time_years: "How many years after final disbursement until the guarantee is released?",
  guarantee_limit_collateral_description: "What collateral is the guarantee limited to?",

  // Spouse (413)
  has_spouse: "Are you married?",
  spouse_full_name: "What is your spouse's full name?",
  spouse_full_ssn: "What is your spouse's Social Security Number?",

  // Loan basics
  amount_requested: "How much are you requesting to borrow?",
  use_of_proceeds: "What will the loan proceeds be used for?",
  loan_purpose: "What is the purpose of this loan?",
  jobs_to_be_created: "How many jobs will be created in the next two years as a result of this loan?",
  jobs_to_be_retained: "How many jobs will be retained in the next two years as a result of this loan?",
  is_eligible_passive_company: "Is this an Eligible Passive Company (EPC) / Operating Company structure?",

  // Operating company (1244 EPC)
  oc_legal_name: "What is the Operating Company's legal name?",
  oc_address: "What is the Operating Company's business address?",
  oc_dba: "Does the Operating Company have a DBA name?",
  oc_legal_structure: "What is the Operating Company's legal structure?",
  oc_tax_id: "What is the Operating Company's Tax ID?",
  oc_duns_number: "What is the Operating Company's DUNS number?",
  oc_contact_name: "Who is the Operating Company's primary contact?",
  oc_email: "What is the Operating Company's email address?",
  oc_phone: "What is the Operating Company's phone number?",
  oc_website: "What is the Operating Company's website?",

  // Standby (155)
  standby_creditor_name: "What is the standby creditor (seller) name?",
  standby_note_interest_amount: "What is the standby note interest owed as of this agreement?",
  standby_agreement_option: "Which payment arrangement does the standby creditor agree to (1-4)?",
  note_date: "What is the payment start date for option 4?",
  note_interest_rate: "What is the standby note interest rate?",

  // Contractor (601)
  contractor_name: "What is the contractor's name?",
  contractor_address: "What is the contractor's address?",
  contractor_phone: "What is the contractor's phone number?",
  contractor_authorized_official: "Who is the contractor's authorized official (name and title)?",

  // Tax (4506-C)
  tax_years: "Which tax year(s) should the IRS transcript cover?",

  // Entity
  entity_legal_name: "What is the entity's legal name?",
  entity_ein: "What is the entity's EIN?",
  entity_type_of_entity: "What type of entity is this?",
  entity_address_street: "What is the entity's street address?",
  entity_address_city: "What city is the entity located in?",
  entity_address_state: "What state is the entity located in?",
  entity_address_zip: "What is the entity's ZIP code?",

  // PFS line items
  asset_cash_on_hand_and_in_banks: "Cash on hand and in banks?",
  asset_savings_accounts: "Savings accounts balance?",
  asset_ira_retirement: "IRA or other retirement account balance?",
  asset_accounts_notes_receivable: "Accounts and notes receivable?",
  asset_life_insurance_cash_surrender_value: "Life insurance cash surrender value?",
  asset_stocks_bonds: "Stocks and bonds value?",
  asset_real_estate: "Real estate value?",
  asset_automobile: "Automobile(s) present value?",
  asset_other_personal_property: "Other personal property value?",
  asset_other: "Other assets value?",
  liability_accounts_payable: "Accounts payable?",
  liability_notes_payable_banks_others: "Notes payable to banks and others?",
  liability_installment_auto: "Installment account — auto?",
  liability_installment_other: "Installment account — other?",
  liability_loan_on_life_insurance: "Loan(s) against life insurance?",
  liability_mortgages_on_real_estate: "Mortgages on real estate?",
  liability_unpaid_taxes: "Unpaid taxes?",
  liability_other: "Other liabilities?",
  net_worth: "Net worth?",
  contingent_as_endorser_or_comaker: "Contingent liability as endorser or co-maker?",
  contingent_legal_claims_judgments: "Contingent legal claims and judgments?",
  contingent_provision_for_federal_income_tax: "Provision for federal income tax?",
  contingent_other_special_debt: "Other special debt?",
  income_salary: "Annual salary?",
  income_net_investment: "Net investment income?",
  income_real_estate: "Real estate income?",
  income_other: "Other income?",
  income_other_description: "Description of other income?",
  other_personal_property_description: "Describe other personal property and assets.",
  unpaid_taxes_description: "Describe unpaid taxes (type, to whom payable, amount, liens).",
  other_liabilities_description: "Describe other liabilities.",
  life_insurance_description: "Describe life insurance held (face amount, CSV, company, beneficiaries).",
  real_estate_property_address: "Primary real estate property address?",
  real_estate_type_title: "Type of real estate title?",
  real_estate_original_cost: "Original cost of real estate?",
  real_estate_present_market_value: "Present market value of real estate?",
  real_estate_amount_of_mortgage: "Amount of mortgage on real estate?",

  // SBA post-approval
  sba_loan_number: "SBA-assigned loan number.",
  sba_loan_closing_date: "SBA loan closing date.",
};

// ── Input type derivation ─────────────────────────────────────────────

function deriveInputType(entry: BorrowerFieldEntry): InputType {
  if (PII_VAULT_KEYS.has(entry.key)) return "ssn";
  if (entry.key === "ein" || entry.key === "entity_ein" || entry.key === "oc_tax_id") return "ein";
  if (entry.key.includes("phone")) return "phone";
  if (entry.key.includes("email")) return "email";
  if (entry.type === "boolean") return "boolean";
  if (entry.type === "date") return "date";
  if (entry.type === "number") {
    if (entry.key.includes("amount") || entry.key.includes("asset_") ||
        entry.key.includes("liability_") || entry.key.includes("income_") ||
        entry.key.includes("contingent_") || entry.key === "net_worth" ||
        entry.key.includes("cost") || entry.key.includes("market_value") ||
        entry.key.includes("mortgage") || entry.key.includes("compensation") ||
        entry.key.includes("limit_balance") || entry.key.includes("limit_principal") ||
        entry.key.includes("limit_max_payment") || entry.key === "export_sales_total") {
      return "currency";
    }
    return "number";
  }
  if (entry.key.includes("description") || entry.key.includes("explanation") ||
      entry.key.includes("history") || entry.key === "use_of_proceeds" ||
      entry.key === "loan_purpose") {
    return "textarea";
  }
  if (entry.key === "entity_type" || entry.key === "veteran_status" ||
      entry.key === "sex" || entry.key === "race" || entry.key === "ethnicity" ||
      entry.key === "citizenship_status" || entry.key === "guarantee_limitation_type" ||
      entry.key === "standby_agreement_option" || entry.key === "entity_type_of_entity" ||
      entry.key === "special_ownership_type" || entry.key === "oc_legal_structure") {
    return "select";
  }
  return "text";
}

// ── Group derivation ──────────────────────────────────────────────────

function deriveGroup(entry: BorrowerFieldEntry): QuestionGroup {
  const k = entry.key;
  if (entry.entityScope === "entity") return "entity_identity";
  if (entry.entityScope === "pfs") {
    if (k.startsWith("asset_")) return "owner_pfs_assets";
    if (k.startsWith("liability_") || k === "net_worth") return "owner_pfs_liabilities";
    if (k.startsWith("income_")) return "owner_pfs_income";
    if (k.startsWith("contingent_")) return "owner_pfs_liabilities";
    if (k.includes("description") || k === "life_insurance_description") return "owner_pfs_narratives";
    if (k.startsWith("real_estate_")) return "owner_pfs_assets";
    return "owner_pfs_assets";
  }
  if (entry.entityScope === "owner") {
    if (CHARACTER_QUESTION_KEYS.has(k)) {
      // incarcerated_or_indicted_financial_crime is primarily 1919 Q4
      // (also triggers 912), so group with 1919 unless it only applies to 912
      const only912 = entry.appliesToForms.every((f) => f === "912");
      if (only912) return "owner_character_912";
      if (entry.appliesToForms.includes("1244") && !entry.appliesToForms.includes("1919")) return "owner_character_1244";
      if (entry.appliesToForms.includes("1919")) return "owner_character_1919";
      return "owner_character_912";
    }
    if (k.startsWith("home_address_") || k === "home_phone" || k === "prior_address_street") return "owner_address";
    if (k === "veteran_status" || k === "sex" || k === "race" || k === "ethnicity") return "owner_demographics";
    if (k.startsWith("guarantee_limit")) return "owner_guarantee";
    if (k === "has_spouse" || k === "spouse_full_name" || k === "spouse_full_ssn") return "owner_spouse";
    if (k.includes("explanation") || k === "all_other_names_used" || k === "residence_history_5yr") return "owner_character_912";
    if (k === "export_sales_total" || k === "export_country_1") return "business_details";
    return "owner_identity";
  }
  if (entry.entityScope === "loan") {
    if (k.startsWith("oc_")) return "loan_operating_company";
    if (k.startsWith("standby_") || k === "note_date" || k === "note_interest_rate") return "loan_standby";
    if (k.startsWith("contractor_")) return "loan_contractor";
    if (k === "tax_years") return "loan_tax";
    return "loan_basic";
  }
  // business scope
  if (k.startsWith("address_") || k === "project_address_street") return "business_address";
  if (k === "phone") return "business_address";
  if (k === "contact_name" || k === "contact_email" || k === "website") return "business_contacts";
  if (k === "legal_name" || k === "dba" || k === "ein" || k === "entity_type") return "business_identity";
  return "business_details";
}

// ── Conditional display logic ─────────────────────────────────────────

function deriveConditionalOn(entry: BorrowerFieldEntry): string | undefined {
  const k = entry.key;
  if (k.startsWith("oc_")) return "is_eligible_passive_company";
  if (k === "prior_cdc_lender_name_and_program") return "prior_application_submitted";
  if (k === "sba_loan_entity_interest_details") return "sba_loan_entity_interest";
  if (k === "alien_registration_number") return "citizenship_status";
  if (k === "country_of_citizenship") return "citizenship_status";
  if (k.startsWith("guarantee_limit_")) return "guarantee_limitation_type";
  if (k === "spouse_full_name" || k === "spouse_full_ssn") return "has_spouse";
  if (k.startsWith("export_")) return "has_export_sales";
  if (k === "arrest_explanation") return "arrested_or_charged_6mo";
  if (k === "conviction_explanation") return "convicted_diversion_or_parole";
  if (k === "indictment_explanation") return "subject_to_indictment";
  if (k === "parole_explanation") return "on_parole_or_probation";
  if (k === "note_date") return "standby_agreement_option";
  return undefined;
}

// ── Public API ────────────────────────────────────────────────────────

function buildQuestion(entry: BorrowerFieldEntry): FormQuestion {
  return {
    key: entry.key,
    registryEntry: entry,
    question: QUESTION_TEXT[entry.key] ?? entry.label,
    inputType: deriveInputType(entry),
    group: deriveGroup(entry),
    requiresExplicitConfirmation: CHARACTER_QUESTION_KEYS.has(entry.key),
    requiresPiiVault: PII_VAULT_KEYS.has(entry.key),
    conditionalOn: deriveConditionalOn(entry),
  };
}

/** All questions for a given form code, ordered by group. */
export function questionsForForm(formCode: string): FormQuestion[] {
  return fieldsForForm(formCode).map(buildQuestion);
}

/** Only required questions for a given form code. */
export function requiredQuestionsForForm(formCode: string): FormQuestion[] {
  return requiredFieldsForForm(formCode).map(buildQuestion);
}

/** All questions across all applicable forms, deduplicated by key. */
export function questionsForForms(formCodes: string[]): FormQuestion[] {
  const seen = new Set<string>();
  const questions: FormQuestion[] = [];
  for (const code of formCodes) {
    for (const entry of fieldsForForm(code)) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      questions.push(buildQuestion(entry));
    }
  }
  return questions;
}

/** The full question bank — every registry entry as a FormQuestion. */
export function fullQuestionBank(): FormQuestion[] {
  return BORROWER_FIELD_REGISTRY
    .filter((e) => e.appliesToForms.length > 0)
    .map(buildQuestion);
}

export { CHARACTER_QUESTION_KEYS, PII_VAULT_KEYS };
