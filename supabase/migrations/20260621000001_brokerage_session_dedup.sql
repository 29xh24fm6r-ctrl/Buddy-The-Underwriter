-- ============================================================================
-- SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.1 — Duplicate draft-deal prevention.
--
-- Two safeguards layered:
--   1. Denormalized brokerage_session_token_hash column on deals + partial
--      unique index. Prevents the same hash being re-used across two
--      'brokerage_anonymous' deals under the same brokerage tenant.
--   2. claim_brokerage_session(p_bank_id, p_token_hash) RPC. Takes a
--      per-tenant pg_advisory_xact_lock so the create-if-absent path
--      serializes on the brokerage tenant. The same-token recheck inside
--      the lock prevents a duplicate insert when a client retries with
--      an in-flight token.
--
-- Both safeguards are additive. No destructive schema change.
-- ============================================================================

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS brokerage_session_token_hash text;

COMMENT ON COLUMN public.deals.brokerage_session_token_hash IS
  'SHA-256 of the borrower_session_tokens token that created this deal. NULL outside the brokerage funnel. Used by the partial unique deals_brokerage_anon_one_per_token to prevent duplicate drafts per (bank, session).';

-- At most one origin='brokerage_anonymous' deal per (bank, token_hash).
-- Outside the brokerage funnel the column is NULL → index has no row.
CREATE UNIQUE INDEX IF NOT EXISTS deals_brokerage_anon_one_per_token
  ON public.deals (bank_id, brokerage_session_token_hash)
  WHERE origin = 'brokerage_anonymous'
    AND brokerage_session_token_hash IS NOT NULL;

-- Atomic create-if-absent under per-tenant advisory lock.
--
-- Returns:
--   { deal_id uuid, created_now boolean }
--
-- created_now = true when we inserted a new (deal, token) pair.
-- created_now = false when a row for p_token_hash already existed (we
-- looked it up and returned the prior deal_id).
--
-- Caller responsibility: p_token_hash must already be the SHA-256 hex
-- of the raw cookie token. The RPC does not hash; it stores what it is
-- given (preserves the security invariant that the DB never sees raw
-- tokens).
CREATE OR REPLACE FUNCTION public.claim_brokerage_session(
  p_bank_id uuid,
  p_token_hash text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deal_id uuid;
BEGIN
  IF p_bank_id IS NULL OR p_token_hash IS NULL OR length(p_token_hash) <> 64 THEN
    RAISE EXCEPTION 'invalid_arguments' USING ERRCODE = '22023';
  END IF;

  -- Serialize cookie-less create attempts per brokerage tenant. Cookie-
  -- bearing requests will hit the recheck below and return early without
  -- contention beyond the lock acquisition.
  PERFORM pg_advisory_xact_lock(
    hashtext('brokerage_session_create:' || p_bank_id::text)
  );

  -- Recheck inside the lock. If a session token row already exists for
  -- this hash, return its deal_id without inserting anything.
  SELECT deal_id INTO v_deal_id
    FROM public.borrower_session_tokens
    WHERE token_hash = p_token_hash;

  IF v_deal_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'deal_id', v_deal_id,
      'created_now', false
    );
  END IF;

  -- Insert deal first so the FK from borrower_session_tokens succeeds.
  INSERT INTO public.deals (
    bank_id,
    deal_type,
    origin,
    display_name,
    brokerage_session_token_hash
  ) VALUES (
    p_bank_id,
    'SBA',
    'brokerage_anonymous',
    'New borrower inquiry',
    p_token_hash
  )
  RETURNING id INTO v_deal_id;

  INSERT INTO public.borrower_session_tokens (token_hash, deal_id, bank_id)
  VALUES (p_token_hash, v_deal_id, p_bank_id);

  RETURN jsonb_build_object(
    'deal_id', v_deal_id,
    'created_now', true
  );
END
$$;

COMMENT ON FUNCTION public.claim_brokerage_session IS
  'Atomic create-if-absent for brokerage borrower sessions. Single source of truth for draft-deal creation in the brokerage funnel. Both the concierge route and the session helper call through here.';
