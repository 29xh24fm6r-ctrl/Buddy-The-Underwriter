-- Pricing Quote Writer + Memo Generator Tables
-- Part 1: risk_facts, pricing_quotes, generated_documents

-- 1) risk_facts: Normalized, versioned "truth set" derived from snapshot context
CREATE TABLE IF NOT EXISTS public.risk_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL,
  facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  facts_hash TEXT NOT NULL,
  confidence JSONB NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_risk_facts_deal_created ON public.risk_facts(deal_id, created_at DESC);
CREATE INDEX idx_risk_facts_snapshot ON public.risk_facts(snapshot_id);
CREATE INDEX idx_risk_facts_hash ON public.risk_facts(facts_hash);

COMMENT ON TABLE public.risk_facts IS 'Normalized risk facts derived from deal snapshots';
COMMENT ON COLUMN public.risk_facts.facts IS 'Structured facts: borrower, collateral, loan, financial, exceptions';
COMMENT ON COLUMN public.risk_facts.facts_hash IS 'Stable hash of canonicalized JSON for caching/comparison';

-- 2) pricing_quotes: Quote + assumptions, derived from risk facts
CREATE TABLE IF NOT EXISTS public.pricing_quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL,
  risk_facts_id UUID NOT NULL REFERENCES public.risk_facts(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'proposed', 'sent', 'archived')),
  quote JSONB NOT NULL DEFAULT '{}'::jsonb,
  assumptions JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_pricing_quotes_deal_created ON public.pricing_quotes(deal_id, created_at DESC);
CREATE INDEX idx_pricing_quotes_status ON public.pricing_quotes(status);
CREATE INDEX idx_pricing_quotes_risk_facts ON public.pricing_quotes(risk_facts_id);

COMMENT ON TABLE public.pricing_quotes IS 'Pricing quotes with assumptions, editable and versioned';
COMMENT ON COLUMN public.pricing_quotes.quote IS 'Quote details: product, rate, fees, structure, conditions, rationale';
COMMENT ON COLUMN public.pricing_quotes.assumptions IS 'Assumptions used to generate quote';

-- 3) generated_documents: Versioned memo outputs (JSON + PDF)
CREATE TABLE IF NOT EXISTS public.generated_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  snapshot_id UUID NOT NULL,
  doc_type TEXT NOT NULL CHECK (doc_type IN ('credit_memo', 'pricing_quote', 'term_sheet', 'other')),
  title TEXT NOT NULL,
  source JSONB NOT NULL DEFAULT '{}'::jsonb,
  content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  pdf_storage_path TEXT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'final')),
  created_by UUID NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_generated_documents_deal_created ON public.generated_documents(deal_id, created_at DESC);
CREATE INDEX idx_generated_documents_doc_type ON public.generated_documents(doc_type, created_at DESC);
CREATE INDEX idx_generated_documents_snapshot ON public.generated_documents(snapshot_id);

COMMENT ON TABLE public.generated_documents IS 'Versioned generated documents (memos, quotes, term sheets) with JSON + PDF';
COMMENT ON COLUMN public.generated_documents.source IS 'Source IDs: risk_facts_id, pricing_quote_id, snapshot_id, facts_hash';
COMMENT ON COLUMN public.generated_documents.content_json IS 'Structured document content (memo schema, quote schema, etc.)';

-- Optional: Add RLS policies (adjust based on your auth setup)
-- ALTER TABLE public.risk_facts ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.pricing_quotes ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE public.generated_documents ENABLE ROW LEVEL SECURITY;

-- Storage bucket for PDFs (run this in Supabase Dashboard or via API):
-- INSERT INTO storage.buckets (id, name, public) VALUES ('generated-documents', 'generated-documents', false);

-- Storage policies (example - adjust to your auth):
-- CREATE POLICY "Authenticated users can read generated docs"
--   ON storage.objects FOR SELECT
--   USING (bucket_id = 'generated-documents' AND auth.role() = 'authenticated');
