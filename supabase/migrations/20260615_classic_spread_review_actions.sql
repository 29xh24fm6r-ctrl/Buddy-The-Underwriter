-- SPEC-CLASSIC-SPREAD-BANKER-REVIEW-ACTIONS-1
-- Banker-reviewable workflow items derived from the Classic Spread accuracy audit's blocker
-- findings. One row per (bank_id, deal_id, finding_key); re-syncing the latest audit UPSERTS on
-- that key so a re-sync never duplicates. Service-role written (the classic-spread API enforces
-- bank scope via ensureDealBankAccess + explicit bank_id filters); RLS is enabled with no public
-- policy so no client can read/write directly.

CREATE TABLE IF NOT EXISTS public.classic_spread_review_actions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id            uuid NOT NULL,
  bank_id            uuid NOT NULL,
  spread_id          uuid,
  period_label       text NOT NULL,
  statement          text NOT NULL,
  row_label          text NOT NULL,
  action_type        text NOT NULL,
  issue_type         text NOT NULL,
  severity           text NOT NULL,
  status             text NOT NULL DEFAULT 'open'
                       CHECK (status IN (
                         'open','confirmed_resolved_value','rejected_source_value',
                         'borrower_detail_requested','source_verified','waived','closed'
                       )),
  recommended_value  numeric,
  source_value       numeric,
  diff_value         numeric,
  source_document_id uuid,
  finding_key        text NOT NULL,
  finding_json       jsonb NOT NULL,
  reviewer_user_id   uuid,
  reviewer_note      text,
  decision_json      jsonb,
  reviewed_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT classic_spread_review_actions_unique_finding
    UNIQUE (bank_id, deal_id, finding_key)
);

CREATE INDEX IF NOT EXISTS idx_csra_deal ON public.classic_spread_review_actions (deal_id);
CREATE INDEX IF NOT EXISTS idx_csra_bank_deal ON public.classic_spread_review_actions (bank_id, deal_id);
CREATE INDEX IF NOT EXISTS idx_csra_status ON public.classic_spread_review_actions (deal_id, status);

-- Bank-scope: RLS on, no public policy → only the service role (used by the classic-spread API)
-- can access the table. The API enforces ensureDealBankAccess + bank_id filters.
ALTER TABLE public.classic_spread_review_actions ENABLE ROW LEVEL SECURITY;

-- Keep updated_at fresh on any write.
CREATE OR REPLACE FUNCTION public.touch_classic_spread_review_actions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_csra_touch_updated_at ON public.classic_spread_review_actions;
CREATE TRIGGER trg_csra_touch_updated_at
  BEFORE UPDATE ON public.classic_spread_review_actions
  FOR EACH ROW EXECUTE FUNCTION public.touch_classic_spread_review_actions_updated_at();
