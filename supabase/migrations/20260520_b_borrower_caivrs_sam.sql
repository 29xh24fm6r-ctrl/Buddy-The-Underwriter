BEGIN;

CREATE TABLE IF NOT EXISTS public.borrower_caivrs_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  ownership_entity_id uuid NOT NULL REFERENCES public.ownership_entities(id) ON DELETE CASCADE,

  caivrs_authorization_number text,  -- returned by CAIVRS API on successful check
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','clear','hit','error','expired')),
  hit_count integer NOT NULL DEFAULT 0,
  hit_details jsonb NOT NULL DEFAULT '[]'::jsonb,

  consent_version text NOT NULL,
  consent_text_hash text NOT NULL,
  consent_at timestamptz NOT NULL,

  idempotency_key text NOT NULL UNIQUE,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_caivrs_deal ON public.borrower_caivrs_checks(deal_id);
CREATE INDEX idx_caivrs_status ON public.borrower_caivrs_checks(status);
CREATE INDEX idx_caivrs_active ON public.borrower_caivrs_checks(deal_id, ownership_entity_id, expires_at DESC)
  WHERE status='clear';

ALTER TABLE public.borrower_caivrs_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY caivrs_deny ON public.borrower_caivrs_checks FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY caivrs_select ON public.borrower_caivrs_checks FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_caivrs_checks.bank_id AND m.user_id=auth.uid())
);

CREATE TABLE IF NOT EXISTS public.borrower_sam_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),

  -- Either an entity or an individual is checked
  ownership_entity_id uuid REFERENCES public.ownership_entities(id),
  borrower_id uuid REFERENCES public.borrowers(id),

  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','clear','hit','error')),
  hit_count integer NOT NULL DEFAULT 0,
  hit_details jsonb NOT NULL DEFAULT '[]'::jsonb,

  idempotency_key text NOT NULL UNIQUE,
  raw_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '60 days'),
  created_at timestamptz NOT NULL DEFAULT now(),

  CHECK (ownership_entity_id IS NOT NULL OR borrower_id IS NOT NULL)
);

CREATE INDEX idx_sam_deal ON public.borrower_sam_exclusions(deal_id);
CREATE INDEX idx_sam_active ON public.borrower_sam_exclusions(deal_id, expires_at DESC)
  WHERE status='clear';

ALTER TABLE public.borrower_sam_exclusions ENABLE ROW LEVEL SECURITY;
CREATE POLICY sam_deny ON public.borrower_sam_exclusions FOR ALL USING (false) WITH CHECK (false);
CREATE POLICY sam_select ON public.borrower_sam_exclusions FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id=borrower_sam_exclusions.bank_id AND m.user_id=auth.uid())
);

COMMIT;
