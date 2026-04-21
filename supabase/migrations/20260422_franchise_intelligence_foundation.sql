-- 20260422_franchise_intelligence_foundation.sql
-- Franchise Intelligence Database — Slice 1
-- 6 tables for canonical brand store, SBA directory ingestion, and diff tracking

-- pg_trgm is required for the fuzzy-search trigram index on brand_name.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. franchise_brands — canonical brand identity + SBA eligibility
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.franchise_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Identity
  brand_name text NOT NULL,
  franchisor_legal_name text,
  sba_directory_id text UNIQUE,
  headquarters_state text,
  founding_year integer,
  naics_codes text[],
  industry_category text,

  -- SBA eligibility (from directory)
  sba_eligible boolean NOT NULL DEFAULT false,
  sba_certification_status text NOT NULL DEFAULT 'unknown',
  sba_addendum_required boolean NOT NULL DEFAULT false,
  sba_addendum_type text,
  sba_programs text[] NOT NULL DEFAULT '{}',
  sba_notes text,
  sba_directory_effective_date date,

  -- Investment economics (populated in Slice 2 from FDDs)
  franchise_fee_min numeric,
  franchise_fee_max numeric,
  initial_investment_min numeric,
  initial_investment_max numeric,
  royalty_pct numeric,
  ad_fund_pct numeric,
  net_worth_requirement numeric,
  liquidity_requirement numeric,
  unit_count integer,

  -- Item 19 flag (populated in Slice 3)
  has_item_19 boolean NOT NULL DEFAULT false,

  -- Resolution
  canonical boolean NOT NULL DEFAULT true,
  merged_into_id uuid REFERENCES public.franchise_brands(id),

  -- Metadata
  source text NOT NULL DEFAULT 'sba_directory',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_franchise_brands_name
  ON public.franchise_brands(brand_name);
CREATE INDEX IF NOT EXISTS idx_franchise_brands_sba_eligible
  ON public.franchise_brands(sba_eligible) WHERE sba_eligible = true;
CREATE INDEX IF NOT EXISTS idx_franchise_brands_industry
  ON public.franchise_brands(industry_category);
CREATE INDEX IF NOT EXISTS idx_franchise_brands_investment
  ON public.franchise_brands(initial_investment_min, initial_investment_max);
CREATE INDEX IF NOT EXISTS idx_franchise_brands_name_trgm
  ON public.franchise_brands USING gin (brand_name gin_trgm_ops);

DROP TRIGGER IF EXISTS trg_franchise_brands_updated_at ON public.franchise_brands;
CREATE TRIGGER trg_franchise_brands_updated_at
  BEFORE UPDATE ON public.franchise_brands
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.franchise_brands IS
  'Canonical franchise brand identity + SBA eligibility. Hot tier for Buddy Voice (<50ms). One row per resolved brand.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. franchise_sba_directory_snapshots — raw ingestion from weekly xlsx
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.franchise_sba_directory_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_run_id uuid NOT NULL,
  row_hash text NOT NULL,

  brand_name text NOT NULL,
  franchisor_name text,
  sba_franchise_id text,
  certification text,
  addendum text,
  programs text,
  notes text,

  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fsd_snapshots_sync_run
  ON public.franchise_sba_directory_snapshots(sync_run_id);
CREATE INDEX IF NOT EXISTS idx_fsd_snapshots_brand
  ON public.franchise_sba_directory_snapshots(brand_name);
CREATE INDEX IF NOT EXISTS idx_fsd_snapshots_hash
  ON public.franchise_sba_directory_snapshots(row_hash);

COMMENT ON TABLE public.franchise_sba_directory_snapshots IS
  'Raw rows from each SBA Franchise Directory xlsx download. Content-addressed via row_hash. One row per brand per sync run.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. fdd_filings — one row per FDD filing per brand per year
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fdd_filings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.franchise_brands(id) ON DELETE CASCADE,

  filing_state text NOT NULL,
  filing_year integer NOT NULL,
  effective_date date,
  expiration_date date,

  gcs_path text,
  pdf_sha256 text,
  page_count integer,

  extraction_status text NOT NULL DEFAULT 'pending',
  extraction_error text,
  extracted_at timestamptz,

  item_5_json jsonb,
  item_6_json jsonb,
  item_7_json jsonb,
  item_19_json jsonb,
  item_20_json jsonb,

  source text NOT NULL DEFAULT 'state_portal',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(brand_id, filing_state, filing_year)
);

CREATE INDEX IF NOT EXISTS idx_fdd_filings_brand
  ON public.fdd_filings(brand_id);
CREATE INDEX IF NOT EXISTS idx_fdd_filings_state_year
  ON public.fdd_filings(filing_state, filing_year DESC);
CREATE INDEX IF NOT EXISTS idx_fdd_filings_extraction
  ON public.fdd_filings(extraction_status) WHERE extraction_status != 'complete';

DROP TRIGGER IF EXISTS trg_fdd_filings_updated_at ON public.fdd_filings;
CREATE TRIGGER trg_fdd_filings_updated_at
  BEFORE UPDATE ON public.fdd_filings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

COMMENT ON TABLE public.fdd_filings IS
  'One FDD filing per brand per state per year. PDF stored in GCS. Structured extraction from key Items stored as JSONB. Warm tier for underwriting.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. fdd_item19_facts — normalized performance metrics from Item 19
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.fdd_item19_facts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.franchise_brands(id) ON DELETE CASCADE,
  filing_id uuid REFERENCES public.fdd_filings(id) ON DELETE SET NULL,

  filing_year integer NOT NULL,
  metric_name text NOT NULL,
  metric_type text NOT NULL DEFAULT 'currency',

  value numeric NOT NULL,
  currency text NOT NULL DEFAULT 'USD',

  cohort_definition text,
  cohort_size integer,
  percentile_rank numeric,

  source_page integer,
  extraction_confidence numeric NOT NULL DEFAULT 0.0,

  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(brand_id, filing_year, metric_name, cohort_definition)
);

CREATE INDEX IF NOT EXISTS idx_fdd_item19_brand
  ON public.fdd_item19_facts(brand_id);
CREATE INDEX IF NOT EXISTS idx_fdd_item19_metric
  ON public.fdd_item19_facts(metric_name, filing_year DESC);
CREATE INDEX IF NOT EXISTS idx_fdd_item19_brand_year
  ON public.fdd_item19_facts(brand_id, filing_year DESC);

COMMENT ON TABLE public.fdd_item19_facts IS
  'Normalized financial performance metrics from FDD Item 19. Each row = one metric for one brand for one year. Warm tier for underwriting annotation ("Applicant projects $1.4M AUV; Item 19 median is $921k").';

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. franchise_sync_runs — audit trail for every ingestion run
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.franchise_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source text NOT NULL,
  status text NOT NULL DEFAULT 'running',

  source_file_sha256 text,
  source_effective_date date,
  total_rows_in_source integer NOT NULL DEFAULT 0,
  brands_added integer NOT NULL DEFAULT 0,
  brands_updated integer NOT NULL DEFAULT 0,
  brands_removed integer NOT NULL DEFAULT 0,
  brands_unchanged integer NOT NULL DEFAULT 0,

  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  error_count integer NOT NULL DEFAULT 0,

  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_ms integer,

  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_franchise_sync_runs_source
  ON public.franchise_sync_runs(source, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_franchise_sync_runs_status
  ON public.franchise_sync_runs(status) WHERE status = 'running';

COMMENT ON TABLE public.franchise_sync_runs IS
  'Audit trail for every franchise data ingestion run. Examiner-grade provenance: source, sha256, counts, timing.';

-- FK from snapshots to sync_runs (declared after sync_runs exists)
ALTER TABLE public.franchise_sba_directory_snapshots
  ADD CONSTRAINT fk_fsd_snapshots_sync_run
  FOREIGN KEY (sync_run_id) REFERENCES public.franchise_sync_runs(id) ON DELETE CASCADE;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. franchise_brand_aliases — cross-reference for name resolution
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.franchise_brand_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  brand_id uuid NOT NULL REFERENCES public.franchise_brands(id) ON DELETE CASCADE,
  alias_name text NOT NULL,
  source text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  UNIQUE(alias_name, source)
);

CREATE INDEX IF NOT EXISTS idx_franchise_aliases_brand
  ON public.franchise_brand_aliases(brand_id);
CREATE INDEX IF NOT EXISTS idx_franchise_aliases_name
  ON public.franchise_brand_aliases(alias_name);

COMMENT ON TABLE public.franchise_brand_aliases IS
  'Cross-reference table for brand identity resolution. Maps variant names across SBA Directory, NASAA, state portals to canonical franchise_brands.id.';

-- ═══════════════════════════════════════════════════════════════════════════
-- RLS — deny-all default (service_role bypasses; worker uses service_role)
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE public.franchise_brands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.franchise_sba_directory_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fdd_filings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fdd_item19_facts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.franchise_sync_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.franchise_brand_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY franchise_brands_deny ON public.franchise_brands
  FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY fsd_snapshots_deny ON public.franchise_sba_directory_snapshots
  FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY fdd_filings_deny ON public.fdd_filings
  FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY fdd_item19_facts_deny ON public.fdd_item19_facts
  FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY franchise_sync_runs_deny ON public.franchise_sync_runs
  FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY franchise_aliases_deny ON public.franchise_brand_aliases
  FOR ALL USING (false) WITH CHECK (false);

-- ═══════════════════════════════════════════════════════════════════════════
-- search_franchise_brands RPC — fuzzy-search for Buddy Voice / API route
-- ═══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.search_franchise_brands(
  search_term text,
  result_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  brand_name text,
  franchisor_legal_name text,
  sba_eligible boolean,
  sba_certification_status text,
  sba_addendum_required boolean,
  sba_programs text[],
  sba_notes text,
  franchise_fee_min numeric,
  franchise_fee_max numeric,
  initial_investment_min numeric,
  initial_investment_max numeric,
  royalty_pct numeric,
  net_worth_requirement numeric,
  liquidity_requirement numeric,
  has_item_19 boolean,
  similarity_score real
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fb.id, fb.brand_name, fb.franchisor_legal_name,
    fb.sba_eligible, fb.sba_certification_status,
    fb.sba_addendum_required, fb.sba_programs, fb.sba_notes,
    fb.franchise_fee_min, fb.franchise_fee_max,
    fb.initial_investment_min, fb.initial_investment_max,
    fb.royalty_pct, fb.net_worth_requirement, fb.liquidity_requirement,
    fb.has_item_19,
    similarity(fb.brand_name, search_term) AS similarity_score
  FROM public.franchise_brands fb
  WHERE fb.canonical = true
    AND (
      fb.brand_name % search_term
      OR fb.brand_name ILIKE '%' || search_term || '%'
    )
  ORDER BY similarity(fb.brand_name, search_term) DESC
  LIMIT result_limit;
$$;
