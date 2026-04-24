-- ============================================================================
-- Sprint 2: Borrower voice
-- ============================================================================

-- 1. Extend deal_voice_sessions with borrower-scope columns + actor_scope discriminator.
ALTER TABLE public.deal_voice_sessions
  ALTER COLUMN user_id DROP NOT NULL;

ALTER TABLE public.deal_voice_sessions
  ADD COLUMN IF NOT EXISTS actor_scope text NOT NULL DEFAULT 'banker'
    CHECK (actor_scope IN ('banker', 'borrower')),
  ADD COLUMN IF NOT EXISTS borrower_session_token_hash text,
  ADD COLUMN IF NOT EXISTS borrower_concierge_session_id uuid
    REFERENCES public.borrower_concierge_sessions(id) ON DELETE SET NULL;

-- XOR identity constraint: banker rows carry user_id (no hash);
-- borrower rows carry borrower_session_token_hash (no user_id).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'deal_voice_sessions_actor_scope_identity_xor'
  ) THEN
    ALTER TABLE public.deal_voice_sessions
      ADD CONSTRAINT deal_voice_sessions_actor_scope_identity_xor CHECK (
        (actor_scope = 'banker' AND user_id IS NOT NULL AND borrower_session_token_hash IS NULL)
        OR
        (actor_scope = 'borrower' AND user_id IS NULL AND borrower_session_token_hash IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS deal_voice_sessions_actor_scope_idx
  ON public.deal_voice_sessions (actor_scope);
CREATE INDEX IF NOT EXISTS deal_voice_sessions_borrower_token_hash_idx
  ON public.deal_voice_sessions (borrower_session_token_hash)
  WHERE borrower_session_token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS deal_voice_sessions_borrower_concierge_session_idx
  ON public.deal_voice_sessions (borrower_concierge_session_id)
  WHERE borrower_concierge_session_id IS NOT NULL;

-- 2. Add confirmed_facts column (path A per Sprint 2 planning review).
-- Voice fact extraction writes here; text concierge continues writing to
-- extracted_facts. Reconciliation (score loader merge with voice precedence)
-- is a follow-up ticket, NOT a Sprint 2 blocker.
ALTER TABLE public.borrower_concierge_sessions
  ADD COLUMN IF NOT EXISTS confirmed_facts jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 3. Voice session audit trail.
CREATE TABLE IF NOT EXISTS public.voice_session_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.deal_voice_sessions(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  bank_id uuid NOT NULL REFERENCES public.banks(id),
  actor_scope text NOT NULL CHECK (actor_scope IN ('banker', 'borrower')),
  borrower_session_token_hash text,
  user_id text,
  event_type text NOT NULL CHECK (event_type IN (
    'session_started',
    'utterance_borrower',
    'utterance_assistant',
    'tool_call',
    'fact_extracted',
    'session_ended',
    'error'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT voice_session_audits_actor_scope_identity_xor CHECK (
    (actor_scope = 'banker' AND user_id IS NOT NULL AND borrower_session_token_hash IS NULL)
    OR
    (actor_scope = 'borrower' AND user_id IS NULL AND borrower_session_token_hash IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS voice_session_audits_session_id_idx ON public.voice_session_audits (session_id);
CREATE INDEX IF NOT EXISTS voice_session_audits_deal_id_idx ON public.voice_session_audits (deal_id);
CREATE INDEX IF NOT EXISTS voice_session_audits_actor_scope_idx ON public.voice_session_audits (actor_scope);
CREATE INDEX IF NOT EXISTS voice_session_audits_event_type_idx ON public.voice_session_audits (event_type);
CREATE INDEX IF NOT EXISTS voice_session_audits_created_at_idx ON public.voice_session_audits (created_at DESC);

ALTER TABLE public.voice_session_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS voice_session_audits_select_for_bank_members ON public.voice_session_audits;
CREATE POLICY voice_session_audits_select_for_bank_members
  ON public.voice_session_audits FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = voice_session_audits.bank_id
      AND m.user_id = auth.uid()
  ));

COMMENT ON TABLE public.voice_session_audits IS
  'Per-event audit trail for voice sessions. actor_scope=banker: Clerk user_id populated. actor_scope=borrower: borrower_session_token_hash populated. XOR constraint enforces correctness.';
