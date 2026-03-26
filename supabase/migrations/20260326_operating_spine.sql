-- Phase 55G: Operating Spine — Covenants, Reporting, Monitoring, Action Execution

-- 1. Deal covenants
CREATE TABLE IF NOT EXISTS public.deal_covenants (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  metric            text NOT NULL,
  threshold         text NOT NULL,
  testing_frequency text NOT NULL CHECK (testing_frequency IN ('monthly','quarterly','annually')),
  source_action_id  text,
  status            text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','active','waived')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dcov_deal_id ON public.deal_covenants(deal_id);

-- 2. Deal reporting requirements
CREATE TABLE IF NOT EXISTS public.deal_reporting_requirements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  requirement       text NOT NULL,
  frequency         text NOT NULL CHECK (frequency IN ('monthly','quarterly','annually','ad_hoc')),
  source_action_id  text,
  status            text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','active')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drr_deal_id ON public.deal_reporting_requirements(deal_id);

-- 3. Deal monitoring seeds
CREATE TABLE IF NOT EXISTS public.deal_monitoring_seeds (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  type              text NOT NULL,
  description       text NOT NULL,
  source_action_id  text,
  status            text NOT NULL DEFAULT 'seeded' CHECK (status IN ('seeded','activated','dismissed')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dms_deal_id ON public.deal_monitoring_seeds(deal_id);

-- 4. Deal action executions (audit trail for action → target record)
CREATE TABLE IF NOT EXISTS public.deal_action_executions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id           uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  action_id         text NOT NULL,
  target_system     text NOT NULL,
  target_record_id  uuid,
  execution_status  text NOT NULL CHECK (execution_status IN ('created','updated','already_exists','failed')),
  executed_by       text NOT NULL,
  executed_at       timestamptz NOT NULL DEFAULT now(),
  error_text        text
);
CREATE INDEX IF NOT EXISTS idx_dae_deal_id ON public.deal_action_executions(deal_id);
CREATE INDEX IF NOT EXISTS idx_dae_action_id ON public.deal_action_executions(action_id);

-- RLS
ALTER TABLE public.deal_covenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_reporting_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_monitoring_seeds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_action_executions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.deal_covenants FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON public.deal_reporting_requirements FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON public.deal_monitoring_seeds FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON public.deal_action_executions FOR ALL USING (true) WITH CHECK (true);
