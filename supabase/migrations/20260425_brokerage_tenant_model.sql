-- ============================================================================
-- Sprint 1: Brokerage tenant model + concierge sessions + session tokens
-- ============================================================================

-- 1) bank_kind discriminator on existing banks table.
ALTER TABLE public.banks
  ADD COLUMN IF NOT EXISTS bank_kind text NOT NULL DEFAULT 'commercial_bank'
    CHECK (bank_kind IN ('commercial_bank', 'brokerage'));

COMMENT ON COLUMN public.banks.bank_kind IS
  'Tenant kind discriminator. commercial_bank = bank SaaS tenant owning its own deals. brokerage = Buddy-operated brokerage owning borrower-acquisition deals routed to a marketplace of lender tenants.';

CREATE INDEX IF NOT EXISTS banks_bank_kind_idx ON public.banks (bank_kind);

-- 2) Singleton Buddy Brokerage tenant.
INSERT INTO public.banks (code, name, bank_kind, is_sandbox)
VALUES ('BUDDY_BROKERAGE', 'Buddy Brokerage', 'brokerage', false)
ON CONFLICT (code) DO NOTHING;

-- 3) Borrower concierge sessions.
CREATE TABLE IF NOT EXISTS public.borrower_concierge_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  program text NOT NULL DEFAULT '7a' CHECK (program IN ('7a','504')),
  conversation_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  extracted_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  missing_facts jsonb NOT NULL DEFAULT '[]'::jsonb,
  progress_pct integer NOT NULL DEFAULT 0 CHECK (progress_pct BETWEEN 0 AND 100),
  last_question text,
  last_response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS borrower_concierge_sessions_deal_id_idx
  ON public.borrower_concierge_sessions (deal_id);
CREATE INDEX IF NOT EXISTS borrower_concierge_sessions_bank_id_idx
  ON public.borrower_concierge_sessions (bank_id);

-- S1-2: exactly one concierge session per deal.
CREATE UNIQUE INDEX IF NOT EXISTS borrower_concierge_sessions_deal_id_unique
  ON public.borrower_concierge_sessions (deal_id);

ALTER TABLE public.borrower_concierge_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS concierge_sessions_select_for_bank_members ON public.borrower_concierge_sessions;
CREATE POLICY concierge_sessions_select_for_bank_members
  ON public.borrower_concierge_sessions FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = borrower_concierge_sessions.bank_id
      AND m.user_id = auth.uid()
  ));

-- 4) Borrower session tokens — HASH at rest, raw in cookie only (§3a of master plan).
CREATE TABLE IF NOT EXISTS public.borrower_session_tokens (
  token_hash text PRIMARY KEY,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  claimed_email text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '90 days'),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS borrower_session_tokens_deal_id_idx
  ON public.borrower_session_tokens (deal_id);
CREATE INDEX IF NOT EXISTS borrower_session_tokens_claimed_email_idx
  ON public.borrower_session_tokens (claimed_email)
  WHERE claimed_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS borrower_session_tokens_expires_at_idx
  ON public.borrower_session_tokens (expires_at);

COMMENT ON TABLE public.borrower_session_tokens IS
  'Anonymous brokerage session records. Raw token lives ONLY in the buddy_borrower_session HTTP-only cookie. DB stores SHA-256 hash. Lookups hash the incoming cookie before comparing. 90-day expiry.';
