/**
 * Arc 7 — the single source of truth for every borrower/owner/loan/PFS
 * field any borrower-facing SBA form needs, and where it lives in canonical
 * state. Both the concierge (text) and voice extraction/propagation
 * pipelines, and the "what should Buddy ask next" ranker, read this instead
 * of hardcoding field lists in three places.
 *
 * `factPath` is the dotted path the conversation-extraction JSON uses:
 *   business.*  -> a single object on the merged facts bag
 *   owner.*     -> one entry per person in facts.owners[]
 *   entity.*    -> one entry per equity-owning entity in facts.entities[]
 *   loan.*      -> a single object on the merged facts bag
 *   pfs.*       -> one entry per 20%+ owner in facts.owners[].pfs
 *
 * `requiredForForms` lists only the form codes where this field is
 * `required: true` in that form's own fields.ts — used by the ranker to
 * weigh impact. `appliesToForms` is the superset (including forms where the
 * field is present but optional).
 */

export type BorrowerFieldEntityScope = "business" | "owner" | "entity" | "loan" | "pfs";

export type BorrowerFieldEntry = {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "date";
  entityScope: BorrowerFieldEntityScope;
  factPath: string;
  sourceTable: string;
  sourceColumn: string;
  appliesToForms: string[];
  requiredForForms: string[];
  sensitive: boolean;
};

export const BORROWER_FIELD_REGISTRY: BorrowerFieldEntry[] = [
  // ── business (borrowers, deal-level) ──────────────────────────────────
  { key: "legal_name", label: "Business legal name", type: "string", entityScope: "business", factPath: "business.legal_name", sourceTable: "borrowers", sourceColumn: "legal_name", appliesToForms: ["1919", "1244", "148", "155", "601"], requiredForForms: ["1919", "1244", "148", "155", "601"], sensitive: false },
  { key: "dba", label: "Doing business as (DBA)", type: "string", entityScope: "business", factPath: "business.dba", sourceTable: "borrowers", sourceColumn: "dba", appliesToForms: ["1919", "1244"], requiredForForms: [], sensitive: false },
  { key: "ein", label: "Employer Identification Number (EIN)", type: "string", entityScope: "business", factPath: "business.ein", sourceTable: "borrowers", sourceColumn: "ein", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: true },
  { key: "address_street", label: "Business address — street", type: "string", entityScope: "business", factPath: "business.address_street", sourceTable: "borrowers", sourceColumn: "address_line1", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "address_city", label: "Business address — city", type: "string", entityScope: "business", factPath: "business.address_city", sourceTable: "borrowers", sourceColumn: "city", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "address_state", label: "Business address — state", type: "string", entityScope: "business", factPath: "business.address_state", sourceTable: "borrowers", sourceColumn: "state", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "address_zip", label: "Business address — ZIP", type: "string", entityScope: "business", factPath: "business.address_zip", sourceTable: "borrowers", sourceColumn: "zip", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "phone", label: "Business phone", type: "string", entityScope: "business", factPath: "business.phone", sourceTable: "borrowers", sourceColumn: "phone", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "entity_type", label: "Type of business", type: "string", entityScope: "business", factPath: "business.entity_type", sourceTable: "borrowers", sourceColumn: "entity_type", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "naics_code", label: "NAICS code", type: "string", entityScope: "business", factPath: "business.naics", sourceTable: "borrowers", sourceColumn: "naics_code", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "employee_count", label: "Number of employees", type: "number", entityScope: "business", factPath: "business.employee_count", sourceTable: "borrowers", sourceColumn: "employee_count", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "year_founded", label: "Year business founded", type: "number", entityScope: "business", factPath: "business.year_founded", sourceTable: "borrowers", sourceColumn: "year_founded", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  // These 4 no longer correspond to any real question on the current
  // Form 1919 revision (confirmed against a real copy of the PDF — see
  // docs/sba-forms/TASK-B-ACROFORM-FIELD-VERIFICATION.md) — "1919"
  // removed from applies/required. Left tagged for "1244" since that
  // form hasn't been re-verified against a real PDF yet (backlog per
  // docs/sba-forms/TASK-A-FORM-COVERAGE-AUDIT.md); columns kept as-is,
  // not deleted, since removing them isn't this task's call to make.
  { key: "has_pending_sba_application", label: "Other SBA application pending?", type: "boolean", entityScope: "business", factPath: "business.has_pending_sba_application", sourceTable: "borrowers", sourceColumn: "has_pending_sba_application", appliesToForms: ["1244"], requiredForForms: ["1244"], sensitive: false },
  { key: "has_bankruptcy_history", label: "Bankruptcy pending?", type: "boolean", entityScope: "business", factPath: "business.has_bankruptcy_history", sourceTable: "borrowers", sourceColumn: "has_bankruptcy_history", appliesToForms: ["1244"], requiredForForms: ["1244"], sensitive: false },
  { key: "has_pending_lawsuits", label: "Pending lawsuits?", type: "boolean", entityScope: "business", factPath: "business.has_pending_lawsuits", sourceTable: "borrowers", sourceColumn: "has_pending_lawsuits", appliesToForms: ["1244"], requiredForForms: ["1244"], sensitive: false },
  { key: "is_engaged_in_lobbying", label: "Engaged in lobbying activities?", type: "boolean", entityScope: "business", factPath: "business.is_engaged_in_lobbying", sourceTable: "borrowers", sourceColumn: "is_engaged_in_lobbying", appliesToForms: ["1244"], requiredForForms: ["1244"], sensitive: false },
  { key: "unique_entity_id", label: "SAM.gov Unique Entity ID (UEI)", type: "string", entityScope: "business", factPath: "business.unique_entity_id", sourceTable: "borrowers", sourceColumn: "unique_entity_id", appliesToForms: ["1919"], requiredForForms: [], sensitive: false },
  { key: "special_ownership_type", label: "Special ownership type", type: "string", entityScope: "business", factPath: "business.special_ownership_type", sourceTable: "borrowers", sourceColumn: "special_ownership_type", appliesToForms: ["1919"], requiredForForms: [], sensitive: false },
  { key: "special_ownership_type_other", label: "Special ownership type — other, specify", type: "string", entityScope: "business", factPath: "business.special_ownership_type_other", sourceTable: "borrowers", sourceColumn: "special_ownership_type_other", appliesToForms: ["1919"], requiredForForms: [], sensitive: false },
  { key: "project_address_street", label: "Project address — street, if different from business address", type: "string", entityScope: "business", factPath: "business.project_address_street", sourceTable: "borrowers", sourceColumn: "project_address_street", appliesToForms: ["1919"], requiredForForms: [], sensitive: false },

  // ── owner (ownership_entities, per individual) ────────────────────────
  { key: "full_name", label: "Full legal name", type: "string", entityScope: "owner", factPath: "owner.full_name", sourceTable: "ownership_entities", sourceColumn: "display_name", appliesToForms: ["1919", "1244", "912", "4506c", "148", "413"], requiredForForms: ["1919", "1244", "912", "4506c", "148", "413"], sensitive: false },
  { key: "ownership_pct", label: "Ownership percentage", type: "number", entityScope: "owner", factPath: "owner.ownership_pct", sourceTable: "ownership_entities", sourceColumn: "ownership_pct", appliesToForms: ["148", "912"], requiredForForms: ["148", "912"], sensitive: false },
  { key: "title", label: "Title / role", type: "string", entityScope: "owner", factPath: "owner.title", sourceTable: "ownership_entities", sourceColumn: "title", appliesToForms: [], requiredForForms: [], sensitive: false },
  // Real 912/4506-C/413 fields want the FULL SSN, not last-4 (confirmed
  // against real copies of each PDF) — "912"/"4506c"/"413" removed here,
  // see the full_ssn entry below instead. ssn_last4 stays tagged for
  // "1244" (unconfirmed/backlog) as a masked-display fact elsewhere.
  { key: "ssn_last4", label: "SSN — last 4", type: "string", entityScope: "owner", factPath: "owner.ssn_last4", sourceTable: "ownership_entities", sourceColumn: "tax_id_last4", appliesToForms: ["1244"], requiredForForms: ["1244"], sensitive: true },
  // Full SSN doesn't fit this registry's plain-column model — it's
  // encrypted in deal_pii_records via storeSecurePii()
  // (src/lib/builder/secure/securePiiIntake.ts), not written directly to
  // ownership_entities. sourceTable/sourceColumn point at the vault
  // table so the intake ranker can still see this field is needed; any
  // consumer writing this value must go through storeSecurePii(), never
  // a direct column write.
  { key: "full_ssn", label: "Social Security Number (full)", type: "string", entityScope: "owner", factPath: "owner.full_ssn", sourceTable: "deal_pii_records", sourceColumn: "encrypted_payload", appliesToForms: ["1919", "912", "4506c", "413"], requiredForForms: ["912", "4506c", "413"], sensitive: true },
  { key: "date_of_birth", label: "Date of birth", type: "date", entityScope: "owner", factPath: "owner.date_of_birth", sourceTable: "ownership_entities", sourceColumn: "date_of_birth", appliesToForms: ["1919", "1244", "912", "413"], requiredForForms: ["1919", "1244", "912", "413"], sensitive: true },
  { key: "place_of_birth", label: "Place of birth", type: "string", entityScope: "owner", factPath: "owner.place_of_birth", sourceTable: "ownership_entities", sourceColumn: "place_of_birth", appliesToForms: ["1919", "1244", "912"], requiredForForms: ["1919", "1244", "912"], sensitive: true },
  { key: "citizenship_status", label: "U.S. citizenship status", type: "string", entityScope: "owner", factPath: "owner.citizenship_status", sourceTable: "ownership_entities", sourceColumn: "citizenship_status", appliesToForms: ["1919", "1244", "912"], requiredForForms: ["1919", "1244", "912"], sensitive: true },
  // SBA Procedural Notice 5000-876626 (eff. 2026-03-01) — distinct from
  // citizenship_status; applies to citizens/nationals too, not just LPRs.
  { key: "principal_residence_in_us", label: "Principal residence is in the U.S.", type: "boolean", entityScope: "owner", factPath: "owner.principal_residence_in_us", sourceTable: "ownership_entities", sourceColumn: "principal_residence_in_us", appliesToForms: ["1919", "1244", "912"], requiredForForms: ["1919", "1244", "912"], sensitive: true },
  { key: "alien_registration_number", label: "Alien registration number", type: "string", entityScope: "owner", factPath: "owner.alien_registration_number", sourceTable: "ownership_entities", sourceColumn: "alien_registration_number", appliesToForms: ["1919", "1244"], requiredForForms: [], sensitive: true },
  { key: "home_address_street", label: "Home address — street", type: "string", entityScope: "owner", factPath: "owner.home_address_street", sourceTable: "ownership_entities", sourceColumn: "home_address_street", appliesToForms: ["1919", "1244", "912", "4506c", "148", "413"], requiredForForms: ["1919", "1244", "912", "4506c", "148", "413"], sensitive: false },
  { key: "home_address_city", label: "Home address — city", type: "string", entityScope: "owner", factPath: "owner.home_address_city", sourceTable: "ownership_entities", sourceColumn: "home_address_city", appliesToForms: ["1919", "1244", "912", "4506c", "148", "413"], requiredForForms: ["1919", "1244", "912", "4506c", "148", "413"], sensitive: false },
  { key: "home_address_state", label: "Home address — state", type: "string", entityScope: "owner", factPath: "owner.home_address_state", sourceTable: "ownership_entities", sourceColumn: "home_address_state", appliesToForms: ["1919", "1244", "912", "4506c", "148", "413"], requiredForForms: ["1919", "1244", "912", "4506c", "148", "413"], sensitive: false },
  { key: "home_address_zip", label: "Home address — ZIP", type: "string", entityScope: "owner", factPath: "owner.home_address_zip", sourceTable: "ownership_entities", sourceColumn: "home_address_zip", appliesToForms: ["1919", "1244", "912", "4506c", "148", "413"], requiredForForms: ["1919", "1244", "912", "4506c", "148", "413"], sensitive: false },
  { key: "home_phone", label: "Home phone", type: "string", entityScope: "owner", factPath: "owner.home_phone", sourceTable: "ownership_entities", sourceColumn: "home_phone", appliesToForms: ["413"], requiredForForms: ["413"], sensitive: false },
  { key: "business_phone", label: "Business phone (owner)", type: "string", entityScope: "owner", factPath: "owner.business_phone", sourceTable: "ownership_entities", sourceColumn: "business_phone", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "is_us_government_employee", label: "Employee of U.S. government?", type: "boolean", entityScope: "owner", factPath: "owner.is_us_government_employee", sourceTable: "ownership_entities", sourceColumn: "is_us_government_employee", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "has_other_government_employment", label: "Other government employment?", type: "boolean", entityScope: "owner", factPath: "owner.has_other_government_employment", sourceTable: "ownership_entities", sourceColumn: "has_other_government_employment", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  // Same "1919" removal as the 4 business-scope fields above — these 5
  // categories don't correspond to the real current Form 1919/912
  // revisions (which ask 13 and 3 much more specific questions,
  // respectively — see the new entries below). Kept for "1244"
  // (unconfirmed/backlog) and because src/lib/score/* still depends on
  // these exact columns for underwriting character-flag scoring.
  { key: "arrested_or_charged_6mo", label: "Arrested/charged in last 6 months?", type: "boolean", entityScope: "owner", factPath: "owner.arrested_or_charged_6mo", sourceTable: "ownership_entities", sourceColumn: "arrested_or_charged_6mo", appliesToForms: ["1244"], requiredForForms: ["1244"], sensitive: true },
  { key: "convicted_or_pleaded", label: "Convicted or pleaded guilty/nolo?", type: "boolean", entityScope: "owner", factPath: "owner.convicted_or_pleaded", sourceTable: "ownership_entities", sourceColumn: "convicted_or_pleaded", appliesToForms: ["1244"], requiredForForms: ["1244"], sensitive: true },
  { key: "pending_criminal_charges", label: "Pending criminal charges?", type: "boolean", entityScope: "owner", factPath: "owner.pending_criminal_charges", sourceTable: "ownership_entities", sourceColumn: "pending_criminal_charges", appliesToForms: ["1244"], requiredForForms: ["1244"], sensitive: true },
  { key: "subject_to_indictment", label: "Subject to indictment?", type: "boolean", entityScope: "owner", factPath: "owner.subject_to_indictment", sourceTable: "ownership_entities", sourceColumn: "subject_to_indictment", appliesToForms: ["1244"], requiredForForms: ["1244"], sensitive: true },
  { key: "on_parole_or_probation", label: "On parole or probation?", type: "boolean", entityScope: "owner", factPath: "owner.on_parole_or_probation", sourceTable: "ownership_entities", sourceColumn: "on_parole_or_probation", appliesToForms: ["1244"], requiredForForms: ["1244"], sensitive: true },

  // ── owner — Form 1919 Section II's real 13 yes/no questions (per
  // individual) + demographics + export-sales, and Form 912's real 3
  // questions. Replaces the 5 categories above for 1919/912 specifically.
  { key: "veteran_status", label: "Veteran status", type: "string", entityScope: "owner", factPath: "owner.veteran_status", sourceTable: "ownership_entities", sourceColumn: "veteran_status", appliesToForms: ["1919"], requiredForForms: [], sensitive: false },
  { key: "sex", label: "Sex", type: "string", entityScope: "owner", factPath: "owner.sex", sourceTable: "ownership_entities", sourceColumn: "sex", appliesToForms: ["1919"], requiredForForms: [], sensitive: true },
  { key: "race", label: "Race", type: "string", entityScope: "owner", factPath: "owner.race", sourceTable: "ownership_entities", sourceColumn: "race", appliesToForms: ["1919"], requiredForForms: [], sensitive: true },
  { key: "ethnicity", label: "Ethnicity", type: "string", entityScope: "owner", factPath: "owner.ethnicity", sourceTable: "ownership_entities", sourceColumn: "ethnicity", appliesToForms: ["1919"], requiredForForms: [], sensitive: true },
  { key: "debarred_ineligible_or_bankrupt", label: "Debarred, ineligible, or presently involved in bankruptcy?", type: "boolean", entityScope: "owner", factPath: "owner.debarred_ineligible_or_bankrupt", sourceTable: "ownership_entities", sourceColumn: "debarred_ineligible_or_bankrupt", appliesToForms: ["1919"], requiredForForms: ["1919"], sensitive: true },
  { key: "defaulted_or_delinquent_gov_loan", label: "Delinquent or defaulted on a direct/guaranteed government loan?", type: "boolean", entityScope: "owner", factPath: "owner.defaulted_or_delinquent_gov_loan", sourceTable: "ownership_entities", sourceColumn: "defaulted_or_delinquent_gov_loan", appliesToForms: ["1919"], requiredForForms: ["1919"], sensitive: true },
  { key: "owns_other_business", label: "Applicant or any owner is an owner of another business?", type: "boolean", entityScope: "owner", factPath: "owner.owns_other_business", sourceTable: "ownership_entities", sourceColumn: "owns_other_business", appliesToForms: ["1919"], requiredForForms: ["1919"], sensitive: false },
  { key: "incarcerated_or_indicted_financial_crime", label: "Incarcerated or under indictment for a felony or financial-misconduct/false-statement crime?", type: "boolean", entityScope: "owner", factPath: "owner.incarcerated_or_indicted_financial_crime", sourceTable: "ownership_entities", sourceColumn: "incarcerated_or_indicted_financial_crime", appliesToForms: ["1919", "912"], requiredForForms: ["1919", "912"], sensitive: true },
  // A visual fill-test caught that Q5 is the export gate, not a fee
  // question — there's no separate CDC-fee question on this form
  // revision at all (see fields.ts's comment on has_export_sales).
  // fee_paid_to_cdc_or_broker's column is left in the schema (harmless,
  // unused) in case a future 504-specific form needs it, but it's
  // removed from this registry since it isn't a real 1919 field.
  { key: "has_export_sales", label: "Are any products/services exported, or is this an EWCP loan?", type: "boolean", entityScope: "owner", factPath: "owner.has_export_sales", sourceTable: "ownership_entities", sourceColumn: "has_export_sales", appliesToForms: ["1919"], requiredForForms: ["1919"], sensitive: false },
  { key: "fee_paid_to_lender_or_broker", label: "Fee paid/committed to the Lender or a broker to assist with this application?", type: "boolean", entityScope: "owner", factPath: "owner.fee_paid_to_lender_or_broker", sourceTable: "ownership_entities", sourceColumn: "fee_paid_to_lender_or_broker", appliesToForms: ["1919"], requiredForForms: ["1919"], sensitive: false },
  { key: "restricted_revenue_source", label: "Revenue from gambling, lending, lobbying, or prurient content/services?", type: "boolean", entityScope: "owner", factPath: "owner.restricted_revenue_source", sourceTable: "ownership_entities", sourceColumn: "restricted_revenue_source", appliesToForms: ["1919"], requiredForForms: ["1919"], sensitive: false },
  { key: "sba_employee_conflict", label: "10%+ owner/officer/director is an SBA employee or household member of one?", type: "boolean", entityScope: "owner", factPath: "owner.sba_employee_conflict", sourceTable: "ownership_entities", sourceColumn: "sba_employee_conflict", appliesToForms: ["1919"], requiredForForms: ["1919"], sensitive: false },
  { key: "former_sba_employee_conflict", label: "Associated with a former SBA employee separated less than 1 year?", type: "boolean", entityScope: "owner", factPath: "owner.former_sba_employee_conflict", sourceTable: "ownership_entities", sourceColumn: "former_sba_employee_conflict", appliesToForms: ["1919"], requiredForForms: ["1919"], sensitive: false },
  { key: "congress_legislative_judicial_conflict", label: "10%+ owner/officer/director or household member is a member of Congress or legislative/judicial branch official?", type: "boolean", entityScope: "owner", factPath: "owner.congress_legislative_judicial_conflict", sourceTable: "ownership_entities", sourceColumn: "congress_legislative_judicial_conflict", appliesToForms: ["1919"], requiredForForms: ["1919"], sensitive: false },
  { key: "federal_employee_or_military_conflict", label: "10%+ owner/officer/director or household member is a GS-13+ federal employee or military equivalent?", type: "boolean", entityScope: "owner", factPath: "owner.federal_employee_or_military_conflict", sourceTable: "ownership_entities", sourceColumn: "federal_employee_or_military_conflict", appliesToForms: ["1919"], requiredForForms: ["1919"], sensitive: false },
  { key: "score_or_advisory_council_member", label: "10%+ owner/officer/director or household member is a SCORE volunteer or Small Business Advisory Council member?", type: "boolean", entityScope: "owner", factPath: "owner.score_or_advisory_council_member", sourceTable: "ownership_entities", sourceColumn: "score_or_advisory_council_member", appliesToForms: ["1919"], requiredForForms: ["1919"], sensitive: false },
  { key: "legal_action_pending", label: "Applicant, any owner, or an affiliate presently involved in legal action (including divorce)?", type: "boolean", entityScope: "owner", factPath: "owner.legal_action_pending", sourceTable: "ownership_entities", sourceColumn: "legal_action_pending", appliesToForms: ["1919"], requiredForForms: ["1919"], sensitive: true },
  { key: "riot_related_conviction_past_year", label: "Convicted in the past year of a riot/civil-disorder-related offense?", type: "boolean", entityScope: "owner", factPath: "owner.riot_related_conviction_past_year", sourceTable: "ownership_entities", sourceColumn: "riot_related_conviction_past_year", appliesToForms: ["912"], requiredForForms: ["912"], sensitive: true },
  { key: "delinquent_child_support_60days", label: "More than 60 days delinquent on child support?", type: "boolean", entityScope: "owner", factPath: "owner.delinquent_child_support_60days", sourceTable: "ownership_entities", sourceColumn: "delinquent_child_support_60days", appliesToForms: ["912"], requiredForForms: ["912"], sensitive: true },
  { key: "prior_address_street", label: "Most recent prior address — street (912, if moved within 10 years)", type: "string", entityScope: "owner", factPath: "owner.prior_address_street", sourceTable: "ownership_entities", sourceColumn: "prior_address_street", appliesToForms: ["912"], requiredForForms: [], sensitive: false },
  { key: "export_sales_total", label: "Estimated total export sales this loan will support", type: "number", entityScope: "owner", factPath: "owner.export_sales_total", sourceTable: "ownership_entities", sourceColumn: "export_sales_total", appliesToForms: ["1919"], requiredForForms: [], sensitive: false },
  { key: "export_country_1", label: "Principal export country #1", type: "string", entityScope: "owner", factPath: "owner.export_country_1", sourceTable: "ownership_entities", sourceColumn: "export_country_1", appliesToForms: ["1919"], requiredForForms: [], sensitive: false },
  { key: "all_other_names_used", label: "All other names used", type: "string", entityScope: "owner", factPath: "owner.all_other_names_used", sourceTable: "ownership_entities", sourceColumn: "all_other_names_used", appliesToForms: ["912"], requiredForForms: [], sensitive: true },
  { key: "residence_history_5yr", label: "Residence history (last 5 years)", type: "string", entityScope: "owner", factPath: "owner.residence_history_5yr", sourceTable: "ownership_entities", sourceColumn: "residence_history_5yr", appliesToForms: ["912"], requiredForForms: ["912"], sensitive: true },
  { key: "arrest_explanation", label: "Explanation of arrest(s)/charge(s)", type: "string", entityScope: "owner", factPath: "owner.arrest_explanation", sourceTable: "ownership_entities", sourceColumn: "arrest_explanation", appliesToForms: ["912"], requiredForForms: ["912"], sensitive: true },
  { key: "conviction_explanation", label: "Explanation of conviction(s)/plea(s)", type: "string", entityScope: "owner", factPath: "owner.conviction_explanation", sourceTable: "ownership_entities", sourceColumn: "conviction_explanation", appliesToForms: ["912"], requiredForForms: ["912"], sensitive: true },
  { key: "indictment_explanation", label: "Explanation of pending indictment", type: "string", entityScope: "owner", factPath: "owner.indictment_explanation", sourceTable: "ownership_entities", sourceColumn: "indictment_explanation", appliesToForms: ["912"], requiredForForms: [], sensitive: true },
  { key: "parole_explanation", label: "Explanation of parole/probation status", type: "string", entityScope: "owner", factPath: "owner.parole_explanation", sourceTable: "ownership_entities", sourceColumn: "parole_explanation", appliesToForms: ["912"], requiredForForms: [], sensitive: true },
  { key: "has_spouse", label: "Has spouse (joint filer)?", type: "boolean", entityScope: "owner", factPath: "owner.has_spouse", sourceTable: "ownership_entities", sourceColumn: "has_spouse", appliesToForms: ["413"], requiredForForms: ["413"], sensitive: false },
  { key: "spouse_full_name", label: "Spouse full name", type: "string", entityScope: "owner", factPath: "owner.spouse_full_name", sourceTable: "ownership_entities", sourceColumn: "spouse_full_name", appliesToForms: ["413"], requiredForForms: [], sensitive: false },

  // ── entity (ownership_entities, equity-owning entities) ───────────────
  { key: "entity_legal_name", label: "Entity legal name", type: "string", entityScope: "entity", factPath: "entity.legal_name", sourceTable: "ownership_entities", sourceColumn: "display_name", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "entity_ein", label: "Entity EIN", type: "string", entityScope: "entity", factPath: "entity.ein", sourceTable: "ownership_entities", sourceColumn: "entity_ein", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: true },
  { key: "entity_type_of_entity", label: "Entity type", type: "string", entityScope: "entity", factPath: "entity.entity_type", sourceTable: "ownership_entities", sourceColumn: "entity_type", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "entity_address_street", label: "Entity address — street", type: "string", entityScope: "entity", factPath: "entity.address_street", sourceTable: "ownership_entities", sourceColumn: "entity_address_street", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "entity_address_city", label: "Entity address — city", type: "string", entityScope: "entity", factPath: "entity.address_city", sourceTable: "ownership_entities", sourceColumn: "entity_address_city", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "entity_address_state", label: "Entity address — state", type: "string", entityScope: "entity", factPath: "entity.address_state", sourceTable: "ownership_entities", sourceColumn: "entity_address_state", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },
  { key: "entity_address_zip", label: "Entity address — ZIP", type: "string", entityScope: "entity", factPath: "entity.address_zip", sourceTable: "ownership_entities", sourceColumn: "entity_address_zip", appliesToForms: ["1919", "1244"], requiredForForms: ["1919", "1244"], sensitive: false },

  // ── loan (deal_loan_requests) ──────────────────────────────────────────
  { key: "amount_requested", label: "Loan amount requested", type: "number", entityScope: "loan", factPath: "loan.amount_requested", sourceTable: "deal_loan_requests", sourceColumn: "requested_amount", appliesToForms: ["1919", "148", "155"], requiredForForms: ["1919", "148", "155"], sensitive: false },
  { key: "use_of_proceeds", label: "Use of proceeds", type: "string", entityScope: "loan", factPath: "loan.use_of_proceeds", sourceTable: "deal_loan_requests", sourceColumn: "use_of_proceeds", appliesToForms: ["1919"], requiredForForms: ["1919"], sensitive: false },
  { key: "standby_creditor_name", label: "Standby creditor (seller) name", type: "string", entityScope: "loan", factPath: "loan.standby_creditor_name", sourceTable: "deal_loan_requests", sourceColumn: "standby_creditor_name", appliesToForms: ["155"], requiredForForms: ["155"], sensitive: false },
  { key: "standby_creditor_address", label: "Standby creditor address", type: "string", entityScope: "loan", factPath: "loan.standby_creditor_address", sourceTable: "deal_loan_requests", sourceColumn: "standby_creditor_address", appliesToForms: ["155"], requiredForForms: ["155"], sensitive: false },
  { key: "note_date", label: "Standby note date", type: "date", entityScope: "loan", factPath: "loan.note_date", sourceTable: "deal_loan_requests", sourceColumn: "note_date", appliesToForms: ["155"], requiredForForms: ["155"], sensitive: false },
  { key: "note_interest_rate", label: "Standby note interest rate", type: "number", entityScope: "loan", factPath: "loan.note_interest_rate", sourceTable: "deal_loan_requests", sourceColumn: "note_interest_rate", appliesToForms: ["155"], requiredForForms: [], sensitive: false },
  { key: "subordination_terms_acknowledged", label: "Subordination terms acknowledged", type: "boolean", entityScope: "loan", factPath: "loan.subordination_terms_acknowledged", sourceTable: "deal_loan_requests", sourceColumn: "subordination_terms_acknowledged", appliesToForms: ["155"], requiredForForms: ["155"], sensitive: false },
  { key: "contractor_name", label: "Contractor name", type: "string", entityScope: "loan", factPath: "loan.contractor_name", sourceTable: "deal_loan_requests", sourceColumn: "contractor_name", appliesToForms: ["601"], requiredForForms: [], sensitive: false },
  { key: "compliance_certification_acknowledged", label: "Compliance certification acknowledged", type: "boolean", entityScope: "loan", factPath: "loan.compliance_certification_acknowledged", sourceTable: "deal_loan_requests", sourceColumn: "compliance_certification_acknowledged", appliesToForms: ["601"], requiredForForms: ["601"], sensitive: false },
  { key: "limited_guarantee_cap_amount", label: "Limited guarantee cap amount", type: "number", entityScope: "loan", factPath: "loan.limited_guarantee_cap_amount", sourceTable: "deal_loan_requests", sourceColumn: "limited_guarantee_cap_amount", appliesToForms: ["148"], requiredForForms: [], sensitive: false },
  { key: "tax_years", label: "Tax year(s) requested", type: "string", entityScope: "loan", factPath: "loan.tax_years", sourceTable: "deal_loan_requests", sourceColumn: "tax_years", appliesToForms: ["4506c"], requiredForForms: ["4506c"], sensitive: false },

  // ── pfs (borrower_applicant_financials, per 20%+ owner) ────────────────
  { key: "asset_cash_on_hand_and_in_banks", label: "Cash on hand & in banks", type: "number", entityScope: "pfs", factPath: "pfs.asset_cash_on_hand_and_in_banks", sourceTable: "borrower_applicant_financials", sourceColumn: "liquid_assets", appliesToForms: ["413"], requiredForForms: ["413"], sensitive: false },
  { key: "asset_savings_accounts", label: "Savings accounts", type: "number", entityScope: "pfs", factPath: "pfs.asset_savings_accounts", sourceTable: "borrower_applicant_financials", sourceColumn: "asset_savings_accounts", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "asset_ira_retirement", label: "IRA / other retirement accounts", type: "number", entityScope: "pfs", factPath: "pfs.asset_ira_retirement", sourceTable: "borrower_applicant_financials", sourceColumn: "asset_ira_retirement", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "asset_accounts_notes_receivable", label: "Accounts & notes receivable", type: "number", entityScope: "pfs", factPath: "pfs.asset_accounts_notes_receivable", sourceTable: "borrower_applicant_financials", sourceColumn: "asset_accounts_notes_receivable", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "asset_life_insurance_cash_surrender_value", label: "Life insurance — cash surrender value", type: "number", entityScope: "pfs", factPath: "pfs.asset_life_insurance_cash_surrender_value", sourceTable: "borrower_applicant_financials", sourceColumn: "asset_life_insurance_csv", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "asset_stocks_bonds", label: "Stocks and bonds", type: "number", entityScope: "pfs", factPath: "pfs.asset_stocks_bonds", sourceTable: "borrower_applicant_financials", sourceColumn: "asset_stocks_bonds", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "asset_real_estate", label: "Real estate", type: "number", entityScope: "pfs", factPath: "pfs.asset_real_estate", sourceTable: "borrower_applicant_financials", sourceColumn: "asset_real_estate", appliesToForms: ["413"], requiredForForms: ["413"], sensitive: false },
  { key: "asset_automobile", label: "Automobile(s) present value", type: "number", entityScope: "pfs", factPath: "pfs.asset_automobile", sourceTable: "borrower_applicant_financials", sourceColumn: "asset_automobile", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "asset_other_personal_property", label: "Other personal property", type: "number", entityScope: "pfs", factPath: "pfs.asset_other_personal_property", sourceTable: "borrower_applicant_financials", sourceColumn: "asset_other_personal_property", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "asset_other", label: "Other assets", type: "number", entityScope: "pfs", factPath: "pfs.asset_other", sourceTable: "borrower_applicant_financials", sourceColumn: "asset_other", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "liability_accounts_payable", label: "Accounts payable", type: "number", entityScope: "pfs", factPath: "pfs.liability_accounts_payable", sourceTable: "borrower_applicant_financials", sourceColumn: "liability_accounts_payable", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "liability_notes_payable_banks_others", label: "Notes payable to banks/others", type: "number", entityScope: "pfs", factPath: "pfs.liability_notes_payable_banks_others", sourceTable: "borrower_applicant_financials", sourceColumn: "liability_notes_payable_banks_others", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "liability_installment_auto", label: "Installment account — auto", type: "number", entityScope: "pfs", factPath: "pfs.liability_installment_auto", sourceTable: "borrower_applicant_financials", sourceColumn: "liability_installment_auto", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "liability_installment_other", label: "Installment account — other", type: "number", entityScope: "pfs", factPath: "pfs.liability_installment_other", sourceTable: "borrower_applicant_financials", sourceColumn: "liability_installment_other", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "liability_loan_on_life_insurance", label: "Loan(s) against life insurance", type: "number", entityScope: "pfs", factPath: "pfs.liability_loan_on_life_insurance", sourceTable: "borrower_applicant_financials", sourceColumn: "liability_loan_on_life_insurance", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "liability_mortgages_on_real_estate", label: "Mortgages on real estate", type: "number", entityScope: "pfs", factPath: "pfs.liability_mortgages_on_real_estate", sourceTable: "borrower_applicant_financials", sourceColumn: "liability_mortgages_on_real_estate", appliesToForms: ["413"], requiredForForms: ["413"], sensitive: false },
  { key: "liability_unpaid_taxes", label: "Unpaid taxes", type: "number", entityScope: "pfs", factPath: "pfs.liability_unpaid_taxes", sourceTable: "borrower_applicant_financials", sourceColumn: "liability_unpaid_taxes", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "liability_other", label: "Other liabilities", type: "number", entityScope: "pfs", factPath: "pfs.liability_other", sourceTable: "borrower_applicant_financials", sourceColumn: "liability_other", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "net_worth", label: "Net worth", type: "number", entityScope: "pfs", factPath: "pfs.net_worth", sourceTable: "borrower_applicant_financials", sourceColumn: "net_worth", appliesToForms: ["413"], requiredForForms: ["413"], sensitive: false },
  { key: "contingent_as_endorser_or_comaker", label: "As endorser or co-maker", type: "number", entityScope: "pfs", factPath: "pfs.contingent_as_endorser_or_comaker", sourceTable: "borrower_applicant_financials", sourceColumn: "contingent_as_endorser_or_comaker", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "contingent_legal_claims_judgments", label: "Legal claims & judgments", type: "number", entityScope: "pfs", factPath: "pfs.contingent_legal_claims_judgments", sourceTable: "borrower_applicant_financials", sourceColumn: "contingent_legal_claims_judgments", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "contingent_provision_for_federal_income_tax", label: "Provision for federal income tax", type: "number", entityScope: "pfs", factPath: "pfs.contingent_provision_for_federal_income_tax", sourceTable: "borrower_applicant_financials", sourceColumn: "contingent_provision_for_federal_income_tax", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "contingent_other_special_debt", label: "Other special debt", type: "number", entityScope: "pfs", factPath: "pfs.contingent_other_special_debt", sourceTable: "borrower_applicant_financials", sourceColumn: "contingent_other_special_debt", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "income_salary", label: "Salary", type: "number", entityScope: "pfs", factPath: "pfs.income_salary", sourceTable: "borrower_applicant_financials", sourceColumn: "income_salary", appliesToForms: ["413"], requiredForForms: ["413"], sensitive: false },
  { key: "income_net_investment", label: "Net investment income", type: "number", entityScope: "pfs", factPath: "pfs.income_net_investment", sourceTable: "borrower_applicant_financials", sourceColumn: "income_net_investment", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "income_real_estate", label: "Real estate income", type: "number", entityScope: "pfs", factPath: "pfs.income_real_estate", sourceTable: "borrower_applicant_financials", sourceColumn: "income_real_estate", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "income_other", label: "Other income", type: "number", entityScope: "pfs", factPath: "pfs.income_other", sourceTable: "borrower_applicant_financials", sourceColumn: "income_other", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "income_other_description", label: "Description of other income", type: "string", entityScope: "pfs", factPath: "pfs.income_other_description", sourceTable: "borrower_applicant_financials", sourceColumn: "income_other_description", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  // NOTE: Form 413's real Section 2/3/4 (notes payable, securities, up to
  // 3 real estate properties) are itemized one-to-many schedules, now
  // sourced from borrower_pfs_notes_payable/borrower_pfs_securities/
  // borrower_pfs_real_estate (see form413/inputBuilder.ts) rather than
  // these single-property borrower_applicant_financials columns below.
  // This registry's flat per-owner model doesn't have a clean way to
  // represent "N rows per owner" yet — that's a real gap, not modeled
  // here; the ranker won't currently prompt for schedule rows beyond
  // what these legacy single-property fields already covered.
  { key: "real_estate_property_address", label: "Real estate — property address", type: "string", entityScope: "pfs", factPath: "pfs.real_estate_property_address", sourceTable: "borrower_applicant_financials", sourceColumn: "real_estate_property_address", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "real_estate_type_title", label: "Real estate — type of title", type: "string", entityScope: "pfs", factPath: "pfs.real_estate_type_title", sourceTable: "borrower_applicant_financials", sourceColumn: "real_estate_type_title", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "real_estate_original_cost", label: "Real estate — original cost", type: "number", entityScope: "pfs", factPath: "pfs.real_estate_original_cost", sourceTable: "borrower_applicant_financials", sourceColumn: "real_estate_original_cost", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "real_estate_present_market_value", label: "Real estate — present market value", type: "number", entityScope: "pfs", factPath: "pfs.real_estate_present_market_value", sourceTable: "borrower_applicant_financials", sourceColumn: "real_estate_present_market_value", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
  { key: "real_estate_amount_of_mortgage", label: "Real estate — amount of mortgage", type: "number", entityScope: "pfs", factPath: "pfs.real_estate_amount_of_mortgage", sourceTable: "borrower_applicant_financials", sourceColumn: "real_estate_amount_of_mortgage", appliesToForms: ["413"], requiredForForms: [], sensitive: false },
];

export function fieldsForForm(formCode: string): BorrowerFieldEntry[] {
  return BORROWER_FIELD_REGISTRY.filter((f) => f.appliesToForms.includes(formCode));
}

export function requiredFieldsForForm(formCode: string): BorrowerFieldEntry[] {
  return BORROWER_FIELD_REGISTRY.filter((f) => f.requiredForForms.includes(formCode));
}

export function fieldsForScope(scope: BorrowerFieldEntityScope): BorrowerFieldEntry[] {
  return BORROWER_FIELD_REGISTRY.filter((f) => f.entityScope === scope);
}

/** The property name this field occupies inside its scope's object in the merged facts bag (factPath minus the scope prefix). */
export function factKey(entry: BorrowerFieldEntry): string {
  return entry.factPath.split(".").slice(1).join(".");
}
