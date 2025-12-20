-- 20251220_risk_pricing_engine.sql

CREATE TABLE IF NOT EXISTS public.pricing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','retired')),
  effective_date date NOT NULL,
  notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pricing_policies_status_idx ON public.pricing_policies(status, effective_date DESC);

DROP TRIGGER IF EXISTS trg_pricing_policies_updated_at ON public.pricing_policies;
CREATE TRIGGER trg_pricing_policies_updated_at
BEFORE UPDATE ON public.pricing_policies
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

-- Simple grid: (risk_grade x term_bucket x product_type) => base_spread_bps
CREATE TABLE IF NOT EXISTS public.pricing_grid_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id uuid NOT NULL REFERENCES public.pricing_policies(id) ON DELETE CASCADE,

  product_type text NOT NULL, -- "SBA_7A", "SBA_504_1ST", "SBA_504_2ND", "CLOC", etc.
  risk_grade text NOT NULL,   -- "1".."10" or "A".."E"
  term_min_months int NOT NULL,
  term_max_months int NOT NULL,

  base_spread_bps int NOT NULL, -- over index
  floor_rate_bps int NULL,
  ceiling_rate_bps int NULL,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pricing_grid_lookup_idx
  ON public.pricing_grid_rows(policy_id, product_type, risk_grade, term_min_months, term_max_months);

-- Deal-specific overrides + audit
CREATE TABLE IF NOT EXISTS public.pricing_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  policy_id uuid NOT NULL REFERENCES public.pricing_policies(id) ON DELETE RESTRICT,

  reason text NOT NULL,
  spread_delta_bps int NOT NULL DEFAULT 0,
  fee_delta_bps int NOT NULL DEFAULT 0,

  created_by text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pricing_overrides_deal_idx ON public.pricing_overrides(deal_id, created_at DESC);

-- Price quotes snapshot (auditable)
CREATE TABLE IF NOT EXISTS public.pricing_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,
  policy_id uuid NOT NULL REFERENCES public.pricing_policies(id) ON DELETE RESTRICT,

  product_type text NOT NULL,
  risk_grade text NOT NULL,
  term_months int NOT NULL,
  index_name text NOT NULL, -- "SOFR", "Prime", etc.
  index_rate_bps int NOT NULL,

  base_spread_bps int NOT NULL,
  override_spread_bps int NOT NULL DEFAULT 0,
  final_rate_bps int NOT NULL,

  explain jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pricing_quotes_deal_idx ON public.pricing_quotes(deal_id, created_at DESC);

-- RLS deny all (banker-only via server routes)
ALTER TABLE public.pricing_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_grid_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricing_policies_none ON public.pricing_policies;
CREATE POLICY pricing_policies_none ON public.pricing_policies FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS pricing_grid_rows_none ON public.pricing_grid_rows;
CREATE POLICY pricing_grid_rows_none ON public.pricing_grid_rows FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS pricing_overrides_none ON public.pricing_overrides;
CREATE POLICY pricing_overrides_none ON public.pricing_overrides FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS pricing_quotes_none ON public.pricing_quotes;
CREATE POLICY pricing_quotes_none ON public.pricing_quotes FOR ALL USING (false) WITH CHECK (false);
