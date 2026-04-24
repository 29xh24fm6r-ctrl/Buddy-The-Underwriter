-- ============================================================================
-- Sprint 0: Buddy SBA Score — versioned, with partial unique index for
-- exactly-one-current-per-deal + draft/locked/superseded status.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.buddy_sba_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  score_version text NOT NULL,
  score_status text NOT NULL DEFAULT 'draft'
    CHECK (score_status IN ('draft','locked','superseded')),

  eligibility_passed boolean NOT NULL,
  eligibility_failures jsonb NOT NULL DEFAULT '[]'::jsonb,

  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  band text NOT NULL CHECK (band IN (
    'institutional_prime','strong_fit','selective_fit',
    'specialty_lender','not_eligible'
  )),
  rate_card_tier text CHECK (rate_card_tier IN ('best','standard','widened','widest')),

  borrower_strength jsonb NOT NULL,
  business_strength jsonb NOT NULL,
  deal_structure jsonb NOT NULL,
  repayment_capacity jsonb NOT NULL,
  franchise_quality jsonb,

  narrative text NOT NULL,
  top_strengths jsonb NOT NULL DEFAULT '[]'::jsonb,
  top_weaknesses jsonb NOT NULL DEFAULT '[]'::jsonb,

  input_snapshot jsonb NOT NULL,
  weights_snapshot jsonb NOT NULL,
  computation_context text NOT NULL DEFAULT 'manual'
    CHECK (computation_context IN (
      'manual','concierge_fact_change','document_upload','package_seal','marketplace_relist'
    )),

  computed_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  superseded_at timestamptz
);

CREATE INDEX IF NOT EXISTS buddy_sba_scores_deal_id_idx  ON public.buddy_sba_scores (deal_id);
CREATE INDEX IF NOT EXISTS buddy_sba_scores_bank_id_idx  ON public.buddy_sba_scores (bank_id);
CREATE INDEX IF NOT EXISTS buddy_sba_scores_band_idx     ON public.buddy_sba_scores (band);
CREATE INDEX IF NOT EXISTS buddy_sba_scores_score_idx    ON public.buddy_sba_scores (score);

-- Exactly one current (non-superseded) score per deal — enforced at the DB layer.
CREATE UNIQUE INDEX IF NOT EXISTS buddy_sba_scores_one_current_per_deal
  ON public.buddy_sba_scores (deal_id)
  WHERE superseded_at IS NULL;

-- Convenience view — most-recent current score per deal.
CREATE OR REPLACE VIEW public.buddy_sba_scores_latest AS
SELECT * FROM public.buddy_sba_scores WHERE superseded_at IS NULL;

ALTER TABLE public.buddy_sba_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS buddy_sba_scores_select_for_bank_members ON public.buddy_sba_scores;
CREATE POLICY buddy_sba_scores_select_for_bank_members
  ON public.buddy_sba_scores FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = buddy_sba_scores.bank_id
      AND m.user_id = auth.uid()
  ));

-- No INSERT/UPDATE policies — all writes go through the RPCs in
-- 20260425_supersede_buddy_sba_score_rpc.sql, which run as SECURITY DEFINER.
