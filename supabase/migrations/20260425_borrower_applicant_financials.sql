-- Per-applicant financials captured by concierge + document extraction.
-- Sprint 0 introduces this so the score has a durable source for
-- FICO / liquidity / net worth / industry experience (Category B gaps
-- identified in the 2026-04-24 schema audit).

CREATE TABLE IF NOT EXISTS public.borrower_applicant_financials (
  applicant_id uuid PRIMARY KEY
    REFERENCES public.borrower_applicants(id) ON DELETE CASCADE,
  fico_score integer CHECK (fico_score BETWEEN 300 AND 850),
  fico_source text CHECK (fico_source IN (
    'self_reported','pulled_experian','pulled_equifax','pulled_transunion'
  )),
  fico_pulled_at timestamptz,
  liquid_assets numeric,
  net_worth numeric,
  industry_experience_years integer
    CHECK (industry_experience_years >= 0 AND industry_experience_years <= 80),
  source_document_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.borrower_applicant_financials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bapf_select_for_bank_members ON public.borrower_applicant_financials;
CREATE POLICY bapf_select_for_bank_members
  ON public.borrower_applicant_financials FOR SELECT
  USING (EXISTS (
    SELECT 1
    FROM public.borrower_applicants a
    JOIN public.borrower_applications app ON app.id = a.application_id
    JOIN public.deals d ON d.id = app.deal_id
    JOIN public.bank_user_memberships m ON m.bank_id = d.bank_id
    WHERE a.id = borrower_applicant_financials.applicant_id
      AND m.user_id = auth.uid()
  ));

DROP POLICY IF EXISTS bapf_write_for_bank_members ON public.borrower_applicant_financials;
CREATE POLICY bapf_write_for_bank_members
  ON public.borrower_applicant_financials FOR ALL
  USING (EXISTS (
    SELECT 1
    FROM public.borrower_applicants a
    JOIN public.borrower_applications app ON app.id = a.application_id
    JOIN public.deals d ON d.id = app.deal_id
    JOIN public.bank_user_memberships m ON m.bank_id = d.bank_id
    WHERE a.id = borrower_applicant_financials.applicant_id
      AND m.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1
    FROM public.borrower_applicants a
    JOIN public.borrower_applications app ON app.id = a.application_id
    JOIN public.deals d ON d.id = app.deal_id
    JOIN public.bank_user_memberships m ON m.bank_id = d.bank_id
    WHERE a.id = borrower_applicant_financials.applicant_id
      AND m.user_id = auth.uid()
  ));
