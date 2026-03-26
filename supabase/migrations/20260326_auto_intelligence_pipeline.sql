-- Phase 58B: Auto-Intelligence Pipeline
CREATE TABLE IF NOT EXISTS public.deal_intelligence_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','partial','succeeded','failed','cancelled')),
  source text NOT NULL CHECK (source IN ('intake_confirm','processing_complete','manual_retry','system_repair')),
  created_by text,
  requested_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  error_code text,
  error_detail text
);
CREATE INDEX IF NOT EXISTS idx_dir_deal ON public.deal_intelligence_runs(deal_id);

CREATE TABLE IF NOT EXISTS public.deal_intelligence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intelligence_run_id uuid NOT NULL REFERENCES public.deal_intelligence_runs(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  step_code text NOT NULL CHECK (step_code IN ('extract_facts','generate_snapshot','lender_match','risk_recompute')),
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','skipped','succeeded','failed')),
  started_at timestamptz,
  completed_at timestamptz,
  summary jsonb NOT NULL DEFAULT '{}',
  error_code text,
  error_detail text,
  UNIQUE(intelligence_run_id, step_code)
);
CREATE INDEX IF NOT EXISTS idx_dis_run ON public.deal_intelligence_steps(intelligence_run_id);

ALTER TABLE public.deal_intelligence_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_intelligence_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.deal_intelligence_runs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON public.deal_intelligence_steps FOR ALL USING (true) WITH CHECK (true);
