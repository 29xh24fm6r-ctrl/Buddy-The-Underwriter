-- Phase 55E: Financial Exception Intelligence
-- Persists classified financial exceptions for audit, memo, and packet reproducibility.

CREATE TABLE IF NOT EXISTS public.financial_exception_instances (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  snapshot_id       uuid,
  source_kind       text NOT NULL,
  exception_kind    text NOT NULL,
  category          text NOT NULL,
  severity          text NOT NULL CHECK (severity IN ('info','low','moderate','high','critical')),
  decision_impact   text NOT NULL,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','deferred')),
  fact_key          text,
  period_key        text,
  title             text NOT NULL,
  summary           text NOT NULL,
  why_it_matters    text NOT NULL,
  recommended_action text,
  committee_disclosure text,
  evidence_json     jsonb NOT NULL DEFAULT '{}',
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fei_deal_id ON public.financial_exception_instances(deal_id);
CREATE INDEX IF NOT EXISTS idx_fei_severity ON public.financial_exception_instances(severity);
CREATE INDEX IF NOT EXISTS idx_fei_status ON public.financial_exception_instances(status);

ALTER TABLE public.financial_exception_instances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.financial_exception_instances
  FOR ALL USING (true) WITH CHECK (true);

-- Extend memo snapshot for exception intelligence
ALTER TABLE IF EXISTS public.credit_memo_snapshots
  ADD COLUMN IF NOT EXISTS financial_exception_summary_json jsonb NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS financial_override_insights_json jsonb NOT NULL DEFAULT '{}';
