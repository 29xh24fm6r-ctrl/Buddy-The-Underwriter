-- 20251220_sba_knowledge_store.sql

CREATE TABLE IF NOT EXISTS public.sba_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key text NOT NULL UNIQUE, -- e.g. "SOP_50_10", "FORM_413", "FORM_148"
  title text NOT NULL,
  url text NOT NULL,
  published_date date NULL,
  effective_date date NULL,
  checksum text NULL,
  last_fetched_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sba_sources_key_idx ON public.sba_sources(source_key);
CREATE INDEX IF NOT EXISTS sba_sources_effective_idx ON public.sba_sources(effective_date DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS public.sba_rule_index (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES public.sba_sources(id) ON DELETE CASCADE,
  rule_key text NOT NULL, -- e.g. "GUARANTY_20PCT", "PFS_REQUIRED"
  summary text NOT NULL,  -- short borrower-safe summary
  details jsonb NOT NULL DEFAULT '{}'::jsonb, -- structured (banker can see full details)
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, rule_key)
);

CREATE INDEX IF NOT EXISTS sba_rule_index_source_idx ON public.sba_rule_index(source_id);
CREATE INDEX IF NOT EXISTS sba_rule_index_key_idx ON public.sba_rule_index(rule_key);

DROP TRIGGER IF EXISTS trg_sba_rule_index_updated_at ON public.sba_rule_index;
CREATE TRIGGER trg_sba_rule_index_updated_at
BEFORE UPDATE ON public.sba_rule_index
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.sba_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sba_rule_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sba_sources_none ON public.sba_sources;
CREATE POLICY sba_sources_none ON public.sba_sources FOR ALL USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS sba_rule_index_none ON public.sba_rule_index;
CREATE POLICY sba_rule_index_none ON public.sba_rule_index FOR ALL USING (false) WITH CHECK (false);
