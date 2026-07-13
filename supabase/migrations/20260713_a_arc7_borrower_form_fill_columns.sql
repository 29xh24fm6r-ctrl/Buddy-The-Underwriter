-- Arc 7 — Conversational Complete-Fill (chat + voice -> all borrower forms).
-- Confirmed via information_schema against the live schema: every field the
-- 1919/413/912/4506-C/1244/148/155/601 input builders currently hardcode to
-- null (or stash only in ownership_entities.evidence_json) has no backing
-- column today. Additive, nullable throughout — surfaced via the normal
-- missing-fields mechanism when absent, never defaulted or backfilled.
BEGIN;

-- borrowers — Form 1919/1244 Section I gaps (business profile + pending
-- compliance flags asked of the applicant business as a whole).
ALTER TABLE public.borrowers
  ADD COLUMN IF NOT EXISTS dba text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS employee_count integer,
  ADD COLUMN IF NOT EXISTS year_founded integer,
  ADD COLUMN IF NOT EXISTS has_pending_sba_application boolean,
  ADD COLUMN IF NOT EXISTS has_bankruptcy_history boolean,
  ADD COLUMN IF NOT EXISTS has_pending_lawsuits boolean,
  ADD COLUMN IF NOT EXISTS is_engaged_in_lobbying boolean;

-- ownership_entities — promotes fields that today only live inside
-- evidence_json (form1919/form912's Section II/narrative fields) to real
-- columns, plus entity-owner-only identity fields (Form 1919 Section III).
ALTER TABLE public.ownership_entities
  ADD COLUMN IF NOT EXISTS alien_registration_number text,
  ADD COLUMN IF NOT EXISTS is_us_government_employee boolean,
  ADD COLUMN IF NOT EXISTS has_other_government_employment boolean,
  ADD COLUMN IF NOT EXISTS arrested_or_charged_6mo boolean,
  ADD COLUMN IF NOT EXISTS convicted_or_pleaded boolean,
  ADD COLUMN IF NOT EXISTS pending_criminal_charges boolean,
  ADD COLUMN IF NOT EXISTS subject_to_indictment boolean,
  ADD COLUMN IF NOT EXISTS on_parole_or_probation boolean,
  ADD COLUMN IF NOT EXISTS all_other_names_used text,
  ADD COLUMN IF NOT EXISTS residence_history_5yr text,
  ADD COLUMN IF NOT EXISTS arrest_explanation text,
  ADD COLUMN IF NOT EXISTS conviction_explanation text,
  ADD COLUMN IF NOT EXISTS indictment_explanation text,
  ADD COLUMN IF NOT EXISTS parole_explanation text,
  ADD COLUMN IF NOT EXISTS has_spouse boolean,
  ADD COLUMN IF NOT EXISTS spouse_full_name text,
  ADD COLUMN IF NOT EXISTS home_phone text,
  ADD COLUMN IF NOT EXISTS business_phone text,
  ADD COLUMN IF NOT EXISTS entity_ein text,
  ADD COLUMN IF NOT EXISTS entity_address_street text,
  ADD COLUMN IF NOT EXISTS entity_address_city text,
  ADD COLUMN IF NOT EXISTS entity_address_state text,
  ADD COLUMN IF NOT EXISTS entity_address_zip text;

-- deal_loan_requests — Form 155 (standby creditor), 601 (construction),
-- 148L (limited guarantee cap), 4506-C (tax years) gaps.
ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS standby_creditor_name text,
  ADD COLUMN IF NOT EXISTS standby_creditor_address text,
  ADD COLUMN IF NOT EXISTS note_date date,
  ADD COLUMN IF NOT EXISTS note_interest_rate numeric,
  ADD COLUMN IF NOT EXISTS subordination_terms_acknowledged boolean,
  ADD COLUMN IF NOT EXISTS contractor_name text,
  ADD COLUMN IF NOT EXISTS compliance_certification_acknowledged boolean,
  ADD COLUMN IF NOT EXISTS limited_guarantee_cap_amount numeric,
  ADD COLUMN IF NOT EXISTS tax_years text;

-- borrower_applicant_financials — Form 413's itemized PFS lines. net_worth
-- and liquid_assets already exist; this adds every other asset/liability/
-- contingent-liability/income/REO-summary line so the form's ~35 previously
-- unsourced fields (4 of them required) have somewhere to live.
ALTER TABLE public.borrower_applicant_financials
  ADD COLUMN IF NOT EXISTS asset_savings_accounts numeric,
  ADD COLUMN IF NOT EXISTS asset_ira_retirement numeric,
  ADD COLUMN IF NOT EXISTS asset_accounts_notes_receivable numeric,
  ADD COLUMN IF NOT EXISTS asset_life_insurance_csv numeric,
  ADD COLUMN IF NOT EXISTS asset_stocks_bonds numeric,
  ADD COLUMN IF NOT EXISTS asset_real_estate numeric,
  ADD COLUMN IF NOT EXISTS asset_automobile numeric,
  ADD COLUMN IF NOT EXISTS asset_other_personal_property numeric,
  ADD COLUMN IF NOT EXISTS asset_other numeric,
  ADD COLUMN IF NOT EXISTS liability_accounts_payable numeric,
  ADD COLUMN IF NOT EXISTS liability_notes_payable_banks_others numeric,
  ADD COLUMN IF NOT EXISTS liability_installment_auto numeric,
  ADD COLUMN IF NOT EXISTS liability_installment_other numeric,
  ADD COLUMN IF NOT EXISTS liability_loan_on_life_insurance numeric,
  ADD COLUMN IF NOT EXISTS liability_mortgages_on_real_estate numeric,
  ADD COLUMN IF NOT EXISTS liability_unpaid_taxes numeric,
  ADD COLUMN IF NOT EXISTS liability_other numeric,
  ADD COLUMN IF NOT EXISTS contingent_as_endorser_or_comaker numeric,
  ADD COLUMN IF NOT EXISTS contingent_legal_claims_judgments numeric,
  ADD COLUMN IF NOT EXISTS contingent_provision_for_federal_income_tax numeric,
  ADD COLUMN IF NOT EXISTS contingent_other_special_debt numeric,
  ADD COLUMN IF NOT EXISTS income_salary numeric,
  ADD COLUMN IF NOT EXISTS income_net_investment numeric,
  ADD COLUMN IF NOT EXISTS income_real_estate numeric,
  ADD COLUMN IF NOT EXISTS income_other numeric,
  ADD COLUMN IF NOT EXISTS income_other_description text,
  ADD COLUMN IF NOT EXISTS real_estate_property_address text,
  ADD COLUMN IF NOT EXISTS real_estate_type_title text,
  ADD COLUMN IF NOT EXISTS real_estate_original_cost numeric,
  ADD COLUMN IF NOT EXISTS real_estate_present_market_value numeric,
  ADD COLUMN IF NOT EXISTS real_estate_amount_of_mortgage numeric;

COMMIT;
