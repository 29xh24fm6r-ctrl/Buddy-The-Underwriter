-- Phase 84 T-06 — Idempotency guard RPC body replacement
--
-- Replaces deal_bootstrap_create (8-arg variant, the one called from
-- createUploadSessionApi.ts) with a dedup-aware version:
--
--   1. Before INSERT, look for an existing deal with matching
--      (bank_id, created_by_user_id, lower(trim(name))) created within
--      the configured dedup window, with duplicate_of IS NULL.
--      Window defaults to 4 hours; override via:
--        SET app.deal_dedup_window = '2 hours';
--
--   2. If a match is found → skip INSERT on deals, create a fresh upload
--      session pointing at the existing deal, return reused = true.
--
--   3. If no match → INSERT a new deal (populating created_by_user_id),
--      create a session, return reused = false.
--
-- Returns TABLE(deal_id, session_id, expires_at, reused). The `reused`
-- column is new — callers should read it to distinguish fresh creates
-- from cache hits.
--
-- The other overload (6-arg deal_bootstrap_create returning SETOF deals)
-- is left untouched; it is not in the current call graph.
--
-- DROP is required because the return type changes (adds `reused` column).
-- Postgres does not allow CREATE OR REPLACE to change OUT parameter shape.

DROP FUNCTION IF EXISTS public.deal_bootstrap_create(uuid, text, text, text, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.deal_bootstrap_create(
  p_bank_id uuid,
  p_name text,
  p_created_by text,
  p_source text DEFAULT 'banker',
  p_portal_link_id uuid DEFAULT NULL,
  p_created_by_user_id text DEFAULT NULL,
  p_created_by_email text DEFAULT NULL,
  p_created_by_name text DEFAULT NULL
)
RETURNS TABLE(deal_id uuid, session_id uuid, expires_at timestamp with time zone, reused boolean)
LANGUAGE plpgsql
AS $function$
DECLARE
  v_deal_id uuid;
  v_session_id uuid := gen_random_uuid();
  v_expires_at timestamptz := now() + interval '30 minutes';
  v_reused boolean := false;
  v_window_text text;
  v_window interval;
  v_existing_id uuid;
BEGIN
  -- Resolve dedup window (4h default, override via app.deal_dedup_window)
  v_window_text := current_setting('app.deal_dedup_window', true);
  IF v_window_text IS NULL OR v_window_text = '' THEN
    v_window := interval '4 hours';
  ELSE
    v_window := v_window_text::interval;
  END IF;

  -- Dedup lookup (user-scoped; only if created_by_user_id was provided)
  IF p_created_by_user_id IS NOT NULL THEN
    SELECT id INTO v_existing_id
    FROM public.deals
    WHERE bank_id = p_bank_id
      AND created_by_user_id = p_created_by_user_id
      AND lower(trim(name)) = lower(trim(p_name))
      AND created_at > now() - v_window
      AND duplicate_of IS NULL
    ORDER BY created_at DESC
    LIMIT 1;
  END IF;

  IF v_existing_id IS NOT NULL THEN
    -- Match found — reuse the existing deal, create a fresh upload session
    v_deal_id := v_existing_id;
    v_reused := true;
  ELSE
    -- No match — create new deal
    v_deal_id := gen_random_uuid();
    INSERT INTO public.deals (
      id, bank_id, name, borrower_name, created_at, updated_at,
      intake_state, created_by_user_id
    )
    VALUES (
      v_deal_id, p_bank_id, p_name, p_name, now(), now(),
      'UPLOAD_SESSION_READY', p_created_by_user_id
    );
  END IF;

  -- Always create a fresh upload session (even for reused deals — the
  -- existing session may have expired at 30min, and each upload attempt
  -- deserves its own session identity for traceability).
  INSERT INTO public.deal_upload_sessions (
    id, deal_id, bank_id, created_at, expires_at, status,
    created_by, created_by_user_id, created_by_email, created_by_name,
    source, portal_link_id
  )
  VALUES (
    v_session_id, v_deal_id, p_bank_id, now(), v_expires_at, 'ready',
    p_created_by, p_created_by_user_id, p_created_by_email, p_created_by_name,
    p_source, p_portal_link_id
  );

  RETURN QUERY SELECT v_deal_id, v_session_id, v_expires_at, v_reused;
END;
$function$;

COMMENT ON FUNCTION public.deal_bootstrap_create(uuid, text, text, text, uuid, text, text, text) IS
  'Atomically creates a deal + upload session, OR reuses an existing deal when dedup conditions match. Dedup scope: (bank_id, created_by_user_id, lower(trim(name))) within app.deal_dedup_window (4h default). Phase 84 T-06.';
