-- 20251220_ownership_findings.sql

CREATE TABLE IF NOT EXISTS public.deal_ownership_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL,

  -- normalized person identity
  full_name text NOT NULL,
  email text NULL,

  -- extracted percent (nullable)
  ownership_percent numeric(6,3) NULL,

  -- evidence (borrower-safe: doc label + page + snippet)
  evidence_doc_id uuid NULL,
  evidence_doc_label text NULL,
  evidence_page int NULL,
  evidence_snippet text NULL,

  -- confidence + status
  confidence numeric(4,3) NOT NULL DEFAULT 0.50,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','confirmed','rejected')),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS deal_ownership_findings_deal_idx
  ON public.deal_ownership_findings(deal_id, created_at DESC);

DROP TRIGGER IF EXISTS trg_deal_ownership_findings_updated_at ON public.deal_ownership_findings;
CREATE TRIGGER trg_deal_ownership_findings_updated_at
BEFORE UPDATE ON public.deal_ownership_findings
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.deal_ownership_findings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deal_ownership_findings_none ON public.deal_ownership_findings;
CREATE POLICY deal_ownership_findings_none ON public.deal_ownership_findings
FOR ALL USING (false) WITH CHECK (false);
