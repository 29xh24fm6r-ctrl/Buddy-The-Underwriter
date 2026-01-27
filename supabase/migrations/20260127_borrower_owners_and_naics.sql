-- 20260127_borrower_owners_and_naics.sql
-- Borrower ownership tracking (principals) + NAICS + address columns

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1) borrower_owners: track 20%+ owners for PFS requirements
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.borrower_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id uuid NOT NULL REFERENCES public.borrowers(id) ON DELETE CASCADE,

  -- Identity
  full_name text NOT NULL,
  title text NULL,

  -- Ownership
  ownership_percent numeric(6,3) NULL,
  ownership_source text NOT NULL DEFAULT 'unknown'
    CHECK (ownership_source IN ('unknown','manual','doc_extracted','tax_k1')),

  -- Tax/compliance
  ssn_last4 text NULL,
  is_guarantor boolean NOT NULL DEFAULT false,
  requires_pfs boolean NOT NULL DEFAULT false,

  -- Provenance
  source_doc_id uuid NULL,
  extracted_at timestamptz NULL,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS borrower_owners_borrower_idx
  ON public.borrower_owners(borrower_id, ownership_percent DESC NULLS LAST);

ALTER TABLE public.borrower_owners ENABLE ROW LEVEL SECURITY;

-- Service-role only (same pattern as other internal tables)
DROP POLICY IF EXISTS borrower_owners_service_only ON public.borrower_owners;
CREATE POLICY borrower_owners_service_only ON public.borrower_owners
  FOR ALL USING (false) WITH CHECK (false);

-- ─────────────────────────────────────────────────────────────
-- 2) Add NAICS + address columns to borrowers (idempotent)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.borrowers
  ADD COLUMN IF NOT EXISTS naics_code text NULL,
  ADD COLUMN IF NOT EXISTS naics_description text NULL,
  ADD COLUMN IF NOT EXISTS address_line1 text NULL,
  ADD COLUMN IF NOT EXISTS city text NULL,
  ADD COLUMN IF NOT EXISTS state text NULL,
  ADD COLUMN IF NOT EXISTS zip text NULL,
  ADD COLUMN IF NOT EXISTS state_of_formation text NULL,
  ADD COLUMN IF NOT EXISTS profile_provenance jsonb NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS borrowers_naics_idx ON public.borrowers(naics_code)
  WHERE naics_code IS NOT NULL;

COMMIT;
