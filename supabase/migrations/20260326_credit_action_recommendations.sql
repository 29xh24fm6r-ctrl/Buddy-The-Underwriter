-- Phase 55F: Credit Action Recommendations
-- Persists deterministic underwriting action recommendations from exception intelligence.

CREATE TABLE IF NOT EXISTS public.credit_action_recommendations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id              uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  source_exception_id  text,
  action_type          text NOT NULL,
  category             text NOT NULL,
  severity             text NOT NULL CHECK (severity IN ('info','low','moderate','high','critical')),
  priority             text NOT NULL CHECK (priority IN ('immediate','pre_committee','pre_close','post_close')),
  recommended_text     text NOT NULL,
  rationale            text NOT NULL,
  committee_impact     text,
  proposed_terms_json  jsonb NOT NULL DEFAULT '{}',
  status               text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed','accepted','modified','dismissed','implemented')),
  accepted_by          text,
  accepted_at          timestamptz,
  modified_text        text,
  target_system        text,
  target_record_id     uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_car_deal_id ON public.credit_action_recommendations(deal_id);
CREATE INDEX IF NOT EXISTS idx_car_status ON public.credit_action_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_car_priority ON public.credit_action_recommendations(priority);

ALTER TABLE public.credit_action_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON public.credit_action_recommendations
  FOR ALL USING (true) WITH CHECK (true);

-- Extend memo snapshot for credit action state
ALTER TABLE IF EXISTS public.credit_memo_snapshots
  ADD COLUMN IF NOT EXISTS credit_action_summary_json jsonb NOT NULL DEFAULT '{}';
