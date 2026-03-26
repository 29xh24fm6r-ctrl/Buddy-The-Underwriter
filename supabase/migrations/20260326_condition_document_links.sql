-- Phase 54A: Condition-to-Document Intent Links
-- Tracks explicit borrower intent when uploading against a condition,
-- as well as automated classifier matches and banker manual links.
-- One document may satisfy multiple conditions (join table, not FK on deal_documents).

CREATE TABLE IF NOT EXISTS public.condition_document_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id     uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  condition_id uuid NOT NULL,
  document_id uuid NOT NULL,
  link_source text NOT NULL CHECK (link_source IN (
    'borrower_targeted',
    'classifier_match',
    'banker_manual',
    'system_recompute'
  )),
  match_confidence numeric(5,4),
  match_reason     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Indexes for lookups
CREATE INDEX IF NOT EXISTS idx_cdl_deal_id ON public.condition_document_links(deal_id);
CREATE INDEX IF NOT EXISTS idx_cdl_condition_id ON public.condition_document_links(condition_id);
CREATE INDEX IF NOT EXISTS idx_cdl_document_id ON public.condition_document_links(document_id);

-- Prevent duplicate links from the same source
CREATE UNIQUE INDEX IF NOT EXISTS idx_cdl_unique_link
  ON public.condition_document_links(condition_id, document_id, link_source);

-- RLS: service_role full access, authenticated users read own bank's deals
ALTER TABLE public.condition_document_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON public.condition_document_links
  FOR ALL USING (true) WITH CHECK (true);
