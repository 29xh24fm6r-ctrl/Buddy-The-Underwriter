-- Closes Task A/B's last "blocked" gap: Forms 148/148L/601/1244 now have
-- real uploaded PDFs (docs/sba-forms/{148,148l,601,1244}-fields.json).
-- Verified content gaps found against the current-revision PDFs:
--
-- 1. Form 148L's "limited guarantee" is not one number — the real form
--    has 7 mutually-exclusive limitation types (balance/principal
--    reduction, max-dollar cap, percentage, time-based, collateral-only,
--    community-property), each per-guarantor (bank-negotiated per
--    owner, not one deal-wide policy) — the old
--    deal_loan_requests.limited_guarantee_cap_amount modeled none of
--    this distinction. New ownership_entities columns.
-- 2. Form 1244's real "Section Two" (per-Associate) asks 5 questions,
--    not the 13 borrowed from Form 1919 the old code assumed — two
--    (Q2 indictment, Q3 arrested-6mo) match existing columns exactly;
--    the other three are new, precisely-scoped columns rather than
--    reusing old-1919 columns whose original semantics don't exactly
--    match (avoiding the same semantic-drift risk this arc has
--    repeatedly found and fixed elsewhere).
-- 3. Form 1244's Section One is a dual-entity (EPC + Operating Company)
--    structure the schema had no representation for at all.
-- 4. Form 601 needs the general contractor's own address/phone/
--    authorized-official — deal_loan_requests already has
--    contractor_name (Arc 7) but nothing else about the contractor.
BEGIN;

-- Form 148L — limitation type is bank-negotiated per guarantor.
ALTER TABLE public.ownership_entities
  ADD COLUMN IF NOT EXISTS guarantee_limitation_type text
    CHECK (guarantee_limitation_type IN (
      'balance_reduction', 'principal_reduction', 'max_liability',
      'percentage', 'time_based', 'collateral', 'community_property'
    )),
  ADD COLUMN IF NOT EXISTS guarantee_limit_balance_under numeric,
  ADD COLUMN IF NOT EXISTS guarantee_limit_principal_under numeric,
  ADD COLUMN IF NOT EXISTS guarantee_limit_max_payment numeric,
  ADD COLUMN IF NOT EXISTS guarantee_limit_percent_payment numeric,
  ADD COLUMN IF NOT EXISTS guarantee_limit_time_years integer,
  ADD COLUMN IF NOT EXISTS guarantee_limit_collateral_description text;

-- Form 1244 Section Two — 2 of 5 real questions match existing columns
-- exactly (subject_to_indictment, arrested_or_charged_6mo); the other 3
-- are new, precisely scoped to this form's actual wording.
ALTER TABLE public.ownership_entities
  ADD COLUMN IF NOT EXISTS former_names_and_dates_used text,
  ADD COLUMN IF NOT EXISTS country_of_citizenship text,
  ADD COLUMN IF NOT EXISTS sba_loan_entity_interest boolean,
  ADD COLUMN IF NOT EXISTS sba_loan_entity_interest_details text,
  ADD COLUMN IF NOT EXISTS convicted_diversion_or_parole boolean,
  ADD COLUMN IF NOT EXISTS suspended_debarred_ineligible boolean;

-- Form 1244 Section One — the Operating Company side of an EPC/OC
-- 504 structure has no representation anywhere; the Applicant/EPC side
-- reuses existing borrowers columns (legal_name/dba/entity_type/ein/
-- phone) plus 3 new ones every 1244 filer needs regardless of EPC/OC.
ALTER TABLE public.borrowers
  ADD COLUMN IF NOT EXISTS duns_number text,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS website text;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS is_eligible_passive_company boolean,
  ADD COLUMN IF NOT EXISTS operating_company_legal_name text,
  ADD COLUMN IF NOT EXISTS operating_company_dba text,
  ADD COLUMN IF NOT EXISTS operating_company_legal_structure text,
  ADD COLUMN IF NOT EXISTS operating_company_tax_id text,
  ADD COLUMN IF NOT EXISTS operating_company_duns_number text,
  ADD COLUMN IF NOT EXISTS operating_company_contact_name text,
  ADD COLUMN IF NOT EXISTS operating_company_email text,
  ADD COLUMN IF NOT EXISTS operating_company_phone text,
  ADD COLUMN IF NOT EXISTS operating_company_website text;

-- Form 601 — the general contractor ("Subrecipient" in the form's HUD-era
-- language) needs its own address/phone/authorized-official; only its
-- name (contractor_name) previously existed.
ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS contractor_address text,
  ADD COLUMN IF NOT EXISTS contractor_phone text,
  ADD COLUMN IF NOT EXISTS contractor_authorized_official text;

COMMIT;
