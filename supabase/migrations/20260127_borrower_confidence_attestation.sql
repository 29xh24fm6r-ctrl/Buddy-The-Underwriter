-- ============================================================================
-- Phase D: Borrower Confidence Scoring + Owner Attestation
-- ============================================================================

-- 1) Per-field confidence scores from AI extraction
ALTER TABLE public.borrowers
  ADD COLUMN IF NOT EXISTS extracted_confidence jsonb NULL;

-- 2) Owner attestation — immutable snapshots
CREATE TABLE IF NOT EXISTS public.borrower_owner_attestations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  borrower_id         uuid        NOT NULL REFERENCES public.borrowers(id) ON DELETE CASCADE,
  attested_by_user_id text        NOT NULL,
  attested_at         timestamptz NOT NULL DEFAULT now(),
  snapshot            jsonb       NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_owner_attestations_borrower
  ON public.borrower_owner_attestations (borrower_id);
