BEGIN;

-- ============================================================
-- SPEC: Form Coverage Audit + AcroForm Field Verification (Task B fix)
--
-- Ground truth for Forms 1919, 413, 912, 4506-C was extracted directly
-- from the real government PDFs (docs/sba-forms/*-fields.json). That
-- surfaced real content gaps, not just field-name mismatches — see
-- docs/sba-forms/TASK-B-ACROFORM-FIELD-VERIFICATION.md for the full
-- finding. This migration adds what's missing so those forms can be
-- filled completely and accurately, not just correctly-named:
--
--   1. Form 1919 Section II (demographics, veteran status, and all 13
--      real compliance yes/no questions) is completed PER COVERED
--      INDIVIDUAL, not once per deal — confirmed from the real PDF's
--      Section II fields sitting alongside a single per-person "ownName"
--      field distinct from Section I's 5-slot ownership roster. These
--      columns therefore live on ownership_entities (per-individual),
--      not deal_loan_requests (deal-level).
--   2. Form 912's real current-revision questions (Q8/Q9/Q10) are
--      narrower than the 5 categories the old columns
--      (arrested_or_charged_6mo, convicted_or_pleaded,
--      pending_criminal_charges, subject_to_indictment,
--      on_parole_or_probation) model — those columns stay untouched
--      (src/lib/score/* already depends on them for underwriting
--      character-flag scoring, confirmed via grep), and the 3 real 912
--      questions get their own columns. Q8's wording is materially the
--      same disclosure as 1919's Q4, so one shared column answers both.
--   3. Full SSN: no full-SSN column is added here. The existing
--      deal_pii_records / storeSecurePii() mechanism
--      (src/lib/builder/secure/securePiiIntake.ts, migration
--      20260326_builder_readiness_secure_intake.sql) already handles
--      encrypted full-SSN storage correctly — this migration adds
--      nothing new for that, only a render-time decrypt helper in
--      application code.
--   4. Form 413's itemized supporting schedules (notes payable,
--      securities, and multi-property real estate) don't exist anywhere
--      — borrower_applicant_financials only has single-row summary
--      fields. New one-to-many child tables, keyed the same way
--      (applicant_id -> ownership_entities.id) as the parent table.
--   5. Form 1919 Section I business-identity fields not modeled
--      anywhere: SAM.gov Unique Entity ID, Special Ownership Type
--      (ESOP/401(k)/Cooperative/Native-American Tribal/Other), and a
--      project address distinct from the business address.
-- ============================================================

-- --------------------------------------------------------------
-- 1) ownership_entities: Form 1919 Section II (per-individual) +
--    Form 912's real questions + demographics + export section +
--    912's "most recent prior address."
-- --------------------------------------------------------------

ALTER TABLE public.ownership_entities
  ADD COLUMN IF NOT EXISTS veteran_status text
    CHECK (veteran_status IS NULL OR veteran_status IN (
      'not_veteran','veteran','service_disabled_veteran','veterans_spouse','not_disclosed'
    )),
  ADD COLUMN IF NOT EXISTS sex text
    CHECK (sex IS NULL OR sex IN ('male','female','not_disclosed')),
  ADD COLUMN IF NOT EXISTS race text
    CHECK (race IS NULL OR race IN (
      'american_indian_or_alaska_native','asian','black_or_african_american',
      'native_hawaiian_or_pacific_islander','white','not_disclosed'
    )),
  ADD COLUMN IF NOT EXISTS ethnicity text
    CHECK (ethnicity IS NULL OR ethnicity IN ('hispanic_or_latino','not_hispanic_or_latino','not_disclosed')),

  -- Form 1919 Section II — the 13 real yes/no questions, one set per
  -- covered individual. Column names are deliberately spelled out
  -- (not "q1"/"q2") so they read on their own in application code and
  -- in any future audit without needing this migration's comment as a
  -- decoder ring.
  ADD COLUMN IF NOT EXISTS debarred_ineligible_or_bankrupt boolean,        -- Q1
  ADD COLUMN IF NOT EXISTS defaulted_or_delinquent_gov_loan boolean,      -- Q2
  ADD COLUMN IF NOT EXISTS owns_other_business boolean,                   -- Q3
  -- Q4 (1919) and Q8 (912) are the same disclosure, worded near-
  -- identically on both forms — one column answers both.
  ADD COLUMN IF NOT EXISTS incarcerated_or_indicted_financial_crime boolean,
  ADD COLUMN IF NOT EXISTS fee_paid_to_cdc_or_broker boolean,             -- Q5 (504/CDC variant)
  ADD COLUMN IF NOT EXISTS fee_paid_to_lender_or_broker boolean,          -- Q6 (7(a)/Lender variant)
  ADD COLUMN IF NOT EXISTS restricted_revenue_source boolean,            -- Q7
  ADD COLUMN IF NOT EXISTS sba_employee_conflict boolean,                 -- Q8 (1919 numbering)
  ADD COLUMN IF NOT EXISTS former_sba_employee_conflict boolean,          -- Q9 (1919 numbering)
  ADD COLUMN IF NOT EXISTS congress_legislative_judicial_conflict boolean,-- Q10 (1919 numbering)
  ADD COLUMN IF NOT EXISTS federal_employee_or_military_conflict boolean, -- Q11 (1919 numbering)
  ADD COLUMN IF NOT EXISTS score_or_advisory_council_member boolean,      -- Q12 (1919 numbering)
  ADD COLUMN IF NOT EXISTS legal_action_pending boolean,                  -- Q13 (1919 numbering)

  -- Form 912-only questions (Q9/Q10 on 912; no 1919 correspondence)
  ADD COLUMN IF NOT EXISTS riot_related_conviction_past_year boolean,
  ADD COLUMN IF NOT EXISTS delinquent_child_support_60days boolean,

  -- Form 912's "most recent prior address (omit if over 10 years ago)"
  ADD COLUMN IF NOT EXISTS prior_address_street text,
  ADD COLUMN IF NOT EXISTS prior_address_city text,
  ADD COLUMN IF NOT EXISTS prior_address_state text,
  ADD COLUMN IF NOT EXISTS prior_address_zip text,

  -- Form 1919 Section II export-sales sub-section
  ADD COLUMN IF NOT EXISTS export_sales_total numeric,
  ADD COLUMN IF NOT EXISTS export_country_1 text,
  ADD COLUMN IF NOT EXISTS export_country_2 text,
  ADD COLUMN IF NOT EXISTS export_country_3 text;

COMMENT ON COLUMN public.ownership_entities.incarcerated_or_indicted_financial_crime IS
  'Shared answer to SBA Form 1919 Section II Q4 and SBA Form 912 Q8 — same disclosure, near-identical wording on both forms.';
COMMENT ON COLUMN public.ownership_entities.riot_related_conviction_past_year IS
  'SBA Form 912 Q9 only — not asked on the current 1919 revision.';
COMMENT ON COLUMN public.ownership_entities.delinquent_child_support_60days IS
  'SBA Form 912 Q10 only — not asked on the current 1919 revision.';

-- --------------------------------------------------------------
-- 2) borrowers: Form 1919 Section I fields with no home today —
--    SAM.gov Unique Entity ID, Special Ownership Type, project address.
-- --------------------------------------------------------------

ALTER TABLE public.borrowers
  ADD COLUMN IF NOT EXISTS unique_entity_id text,
  ADD COLUMN IF NOT EXISTS special_ownership_type text
    CHECK (special_ownership_type IS NULL OR special_ownership_type IN (
      'esop','401k_or_robs','cooperative','native_american_tribal','other'
    )),
  ADD COLUMN IF NOT EXISTS special_ownership_type_other text,
  ADD COLUMN IF NOT EXISTS project_address_street text,
  ADD COLUMN IF NOT EXISTS project_address_city text,
  ADD COLUMN IF NOT EXISTS project_address_state text,
  ADD COLUMN IF NOT EXISTS project_address_zip text;

COMMENT ON COLUMN public.borrowers.unique_entity_id IS
  'SAM.gov Unique Entity ID (UEI), used on SBA Form 1919 Section I.';

-- --------------------------------------------------------------
-- 3) Form 413 itemized supporting schedules — one-to-many, keyed the
--    same way as borrower_applicant_financials (applicant_id ->
--    ownership_entities.id). deal_id is denormalized for RLS/querying,
--    same convention used elsewhere in this schema.
-- --------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.borrower_pfs_notes_payable (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  applicant_id uuid NOT NULL REFERENCES public.ownership_entities(id) ON DELETE CASCADE,
  noteholder_name_address text,
  original_balance numeric,
  current_balance numeric,
  payment_amount numeric,
  payment_frequency text,
  collateral_description text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.borrower_pfs_securities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  applicant_id uuid NOT NULL REFERENCES public.ownership_entities(id) ON DELETE CASCADE,
  number_of_shares numeric,
  name_of_securities text,
  cost numeric,
  market_value_quotation_exchange text,
  date_of_quotation date,
  total_value numeric,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.borrower_pfs_real_estate (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  applicant_id uuid NOT NULL REFERENCES public.ownership_entities(id) ON DELETE CASCADE,
  property_label text NOT NULL DEFAULT 'A' CHECK (property_label IN ('A','B','C')),
  property_type text,
  address text,
  date_purchased date,
  original_cost numeric,
  present_market_value numeric,
  mortgage_holder_name_address text,
  mortgage_account_number text,
  mortgage_balance numeric,
  mortgage_payment_per_month_year text,
  mortgage_status text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (applicant_id, property_label)
);

CREATE INDEX IF NOT EXISTS idx_pfs_notes_payable_applicant ON public.borrower_pfs_notes_payable(applicant_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_pfs_securities_applicant ON public.borrower_pfs_securities(applicant_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_pfs_real_estate_applicant ON public.borrower_pfs_real_estate(applicant_id);

DROP TRIGGER IF EXISTS pfs_notes_payable_set_updated_at ON public.borrower_pfs_notes_payable;
CREATE TRIGGER pfs_notes_payable_set_updated_at
  BEFORE UPDATE ON public.borrower_pfs_notes_payable
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS pfs_securities_set_updated_at ON public.borrower_pfs_securities;
CREATE TRIGGER pfs_securities_set_updated_at
  BEFORE UPDATE ON public.borrower_pfs_securities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS pfs_real_estate_set_updated_at ON public.borrower_pfs_real_estate;
CREATE TRIGGER pfs_real_estate_set_updated_at
  BEFORE UPDATE ON public.borrower_pfs_real_estate
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.borrower_pfs_notes_payable ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrower_pfs_securities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrower_pfs_real_estate ENABLE ROW LEVEL SECURITY;

CREATE POLICY pfs_np_deny ON public.borrower_pfs_notes_payable FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY pfs_np_select_bank ON public.borrower_pfs_notes_payable FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.deals d JOIN public.bank_user_memberships m ON m.bank_id = d.bank_id
    WHERE d.id = borrower_pfs_notes_payable.deal_id AND m.user_id = auth.uid())
);

CREATE POLICY pfs_sec_deny ON public.borrower_pfs_securities FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY pfs_sec_select_bank ON public.borrower_pfs_securities FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.deals d JOIN public.bank_user_memberships m ON m.bank_id = d.bank_id
    WHERE d.id = borrower_pfs_securities.deal_id AND m.user_id = auth.uid())
);

CREATE POLICY pfs_re_deny ON public.borrower_pfs_real_estate FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY pfs_re_select_bank ON public.borrower_pfs_real_estate FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.deals d JOIN public.bank_user_memberships m ON m.bank_id = d.bank_id
    WHERE d.id = borrower_pfs_real_estate.deal_id AND m.user_id = auth.uid())
);

COMMENT ON TABLE public.borrower_pfs_notes_payable IS 'SBA Form 413 Section 2 — itemized notes payable to banks and others, one row per noteholder.';
COMMENT ON TABLE public.borrower_pfs_securities IS 'SBA Form 413 Section 3 — itemized stocks and bonds held, one row per security.';
COMMENT ON TABLE public.borrower_pfs_real_estate IS 'SBA Form 413 Section 4 — up to 3 properties (A/B/C), replacing the single-property summary on borrower_applicant_financials for the itemized schedule.';

COMMIT;
