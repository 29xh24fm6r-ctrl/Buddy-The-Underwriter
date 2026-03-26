-- Phase 55A: Financial Snapshot Validation Model
-- Canonical financial snapshot + fact-level provenance and validation.

-- 1. Canonical financial snapshots (active = only one per deal at a time)
CREATE TABLE IF NOT EXISTS public.financial_snapshots_v2 (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id                 uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id                 uuid NOT NULL,
  status                  text NOT NULL DEFAULT 'not_started'
    CHECK (status IN ('not_started','collecting_inputs','generated','needs_review','partially_validated','validated','stale','superseded')),
  active                  boolean NOT NULL DEFAULT true,
  period_start            text,
  period_end              text,
  entity_scope            jsonb,
  source_document_count   int NOT NULL DEFAULT 0,
  material_fact_count     int NOT NULL DEFAULT 0,
  validated_fact_count    int NOT NULL DEFAULT 0,
  unresolved_conflict_count int NOT NULL DEFAULT 0,
  missing_fact_count      int NOT NULL DEFAULT 0,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  validated_at            timestamptz,
  superseded_by           uuid
);

CREATE INDEX IF NOT EXISTS idx_fsv2_deal_id ON public.financial_snapshots_v2(deal_id);
CREATE INDEX IF NOT EXISTS idx_fsv2_active ON public.financial_snapshots_v2(deal_id, active) WHERE active = true;

-- 2. Financial snapshot facts with provenance + validation state
CREATE TABLE IF NOT EXISTS public.financial_snapshot_facts (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id             uuid NOT NULL REFERENCES public.financial_snapshots_v2(id) ON DELETE CASCADE,
  deal_id                 uuid NOT NULL,
  metric_key              text NOT NULL,
  metric_label            text NOT NULL,
  period_key              text NOT NULL,
  entity_key              text,
  numeric_value           numeric,
  text_value              text,
  unit                    text,
  extraction_confidence   numeric(5,4),
  validation_state        text NOT NULL DEFAULT 'unreviewed'
    CHECK (validation_state IN ('unreviewed','auto_supported','needs_review','banker_confirmed','banker_adjusted','rejected','conflicted','missing')),
  conflict_state          text,
  primary_document_id     uuid,
  provenance              jsonb NOT NULL DEFAULT '[]',
  reviewer_user_id        text,
  reviewer_rationale      text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fsf_snapshot_id ON public.financial_snapshot_facts(snapshot_id);
CREATE INDEX IF NOT EXISTS idx_fsf_deal_id ON public.financial_snapshot_facts(deal_id);
CREATE INDEX IF NOT EXISTS idx_fsf_validation ON public.financial_snapshot_facts(validation_state);
CREATE INDEX IF NOT EXISTS idx_fsf_metric ON public.financial_snapshot_facts(metric_key, period_key);

-- RLS
ALTER TABLE public.financial_snapshots_v2 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_snapshot_facts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.financial_snapshots_v2 FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access" ON public.financial_snapshot_facts FOR ALL USING (true) WITH CHECK (true);
