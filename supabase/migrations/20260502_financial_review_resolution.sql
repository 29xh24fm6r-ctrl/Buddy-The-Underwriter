-- Financial Review Resolution Workflow
-- Adds tables and columns needed for evidence-based banker resolution of financial review items.

-- 1. Add resolution_status to deal_financial_facts (used by computeDealGaps + resolveDealGap)
ALTER TABLE public.deal_financial_facts
  ADD COLUMN IF NOT EXISTS resolution_status text DEFAULT 'pending';

-- 2. Create deal_gap_queue table (referenced by gap engine but never migrated)
CREATE TABLE IF NOT EXISTS public.deal_gap_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL,
  gap_type text NOT NULL CHECK (gap_type IN ('missing_fact', 'low_confidence', 'conflict')),
  fact_type text NOT NULL,
  fact_key text NOT NULL,
  owner_entity_id uuid,
  fact_id uuid,
  conflict_id uuid,
  description text NOT NULL,
  resolution_prompt text NOT NULL DEFAULT '',
  priority int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'deferred')),
  resolved_by text,
  resolved_at timestamptz,
  resolution_meta jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Composite unique for idempotent upserts
CREATE UNIQUE INDEX IF NOT EXISTS deal_gap_queue_upsert_key
  ON public.deal_gap_queue (deal_id, fact_type, fact_key, gap_type, status)
  WHERE status = 'open';

-- Lookup indexes
CREATE INDEX IF NOT EXISTS deal_gap_queue_deal_bank
  ON public.deal_gap_queue (deal_id, bank_id, status);

-- 3. Create deal_fact_conflicts table (referenced by gap engine but never migrated)
CREATE TABLE IF NOT EXISTS public.deal_fact_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL,
  fact_type text NOT NULL,
  fact_key text NOT NULL,
  conflicting_values jsonb NOT NULL DEFAULT '[]',
  conflicting_fact_ids uuid[] NOT NULL DEFAULT '{}',
  owner_entity_id uuid,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  resolved_fact_id uuid,
  resolved_by text,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_fact_conflicts_deal_bank
  ON public.deal_fact_conflicts (deal_id, bank_id, status);

-- 4. Create financial_review_resolutions table for audit-grade resolution tracking
CREATE TABLE IF NOT EXISTS public.financial_review_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL,
  gap_id uuid,
  fact_key text NOT NULL,
  gap_type text NOT NULL,
  action text NOT NULL CHECK (action IN (
    'confirm_value', 'choose_source_value', 'override_value', 'provide_value', 'mark_follow_up'
  )),
  resolved_status text NOT NULL CHECK (resolved_status IN (
    'resolved_confirmed', 'resolved_selected_source', 'resolved_overridden',
    'resolved_provided', 'deferred_follow_up'
  )),
  selected_fact_id uuid,
  selected_conflict_id uuid,
  prior_value numeric,
  resolved_value numeric,
  resolved_period_start date,
  resolved_period_end date,
  rationale text,
  provenance_snapshot jsonb NOT NULL DEFAULT '{}',
  actor_user_id text NOT NULL,
  actor_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS financial_review_resolutions_deal
  ON public.financial_review_resolutions (deal_id, bank_id, fact_key);
