-- Borrower phone links table for SMS phone→borrower resolution
-- Tracks which phone numbers are associated with which borrowers/deals

CREATE TABLE IF NOT EXISTS public.borrower_phone_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Multi-tenant
  bank_id UUID NULL,
  
  -- Phone number (E.164 format)
  phone_e164 TEXT NOT NULL,
  
  -- Borrower context (adapt to your schema)
  borrower_applicant_id UUID NULL,  -- If you have borrower_applicants table
  deal_id UUID NULL,
  
  -- Source tracking
  source TEXT NOT NULL DEFAULT 'portal_link',  -- 'portal_link', 'intake_form', 'manual'
  
  -- Metadata
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Index for fast phone→borrower lookups
CREATE INDEX IF NOT EXISTS borrower_phone_links_phone_idx 
  ON public.borrower_phone_links (phone_e164, created_at DESC);

-- Index for borrower→phone lookups  
CREATE INDEX IF NOT EXISTS borrower_phone_links_borrower_idx
  ON public.borrower_phone_links (borrower_applicant_id) 
  WHERE borrower_applicant_id IS NOT NULL;

-- Index for deal→phone lookups
CREATE INDEX IF NOT EXISTS borrower_phone_links_deal_idx
  ON public.borrower_phone_links (deal_id)
  WHERE deal_id IS NOT NULL;

-- Unique constraint: one phone per borrower per bank (allow updates via upsert)
CREATE UNIQUE INDEX IF NOT EXISTS borrower_phone_links_unique_idx
  ON public.borrower_phone_links (bank_id, phone_e164, COALESCE(borrower_applicant_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Updated at trigger
CREATE OR REPLACE FUNCTION public.set_borrower_phone_links_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS set_borrower_phone_links_updated_at ON public.borrower_phone_links;
CREATE TRIGGER set_borrower_phone_links_updated_at
  BEFORE UPDATE ON public.borrower_phone_links
  FOR EACH ROW EXECUTE FUNCTION public.set_borrower_phone_links_updated_at();

-- RLS (match your existing tenant model)
-- For now: deny-all, access via service role
ALTER TABLE public.borrower_phone_links ENABLE ROW LEVEL SECURITY;

-- Example RLS policy (adjust based on your auth model)
CREATE POLICY borrower_phone_links_tenant_policy ON public.borrower_phone_links
  FOR ALL
  USING (false);  -- Deny all, use supabaseAdmin() with server-side bank_id checks

COMMENT ON TABLE public.borrower_phone_links IS 
  'Phone number → borrower/deal mappings for SMS resolution. Created when sending portal links or capturing borrower phone in intake forms.';
