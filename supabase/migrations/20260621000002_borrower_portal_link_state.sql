-- ============================================================================
-- SPEC-BROKERAGE-LAUNCH-BLOCKERS-V1 §3.3 — borrower_portal_links state
-- machine: expiry, single-use, revoked-at, enforced through SECURITY
-- DEFINER RPCs (`consume_*` / `peek_*`).
--
-- All callers (upload page + upload-commit route + the brokerage bridge)
-- go through these RPCs instead of doing inline SELECT + UPDATE. A
-- leaked URL can no longer be partially replayed because every read
-- runs the same gate.
--
-- Additive schema change only: a new column on borrower_portal_links.
-- Existing rows treat NULL revoked_at as "not revoked".
-- ============================================================================

ALTER TABLE public.borrower_portal_links
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz;

COMMENT ON COLUMN public.borrower_portal_links.revoked_at IS
  'Set when a link is explicitly invalidated (e.g. a new brokerage_self_serve link supersedes it). NULL means not revoked. Enforced server-side by consume/peek RPCs.';

CREATE INDEX IF NOT EXISTS borrower_portal_links_revoked_at_idx
  ON public.borrower_portal_links (revoked_at)
  WHERE revoked_at IS NULL;

-- ── peek_borrower_portal_link ───────────────────────────────────────────
-- Read-only gate. Asserts the link is in a usable state and returns the
-- minimal columns callers need. Raises a typed exception otherwise.
-- Error codes:
--   link_not_found
--   link_expired
--   link_consumed
--   link_revoked
CREATE OR REPLACE FUNCTION public.peek_borrower_portal_link(
  p_token text
)
RETURNS TABLE(deal_id uuid, bank_id uuid, label text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  SELECT id, deal_id, bank_id, label, expires_at, used_at, revoked_at, single_use
    INTO r
    FROM public.borrower_portal_links
    WHERE token = p_token;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF r.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'link_revoked' USING ERRCODE = 'P0001';
  END IF;
  IF r.expires_at IS NOT NULL AND r.expires_at <= now() THEN
    RAISE EXCEPTION 'link_expired' USING ERRCODE = 'P0001';
  END IF;
  IF r.single_use AND r.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'link_consumed' USING ERRCODE = 'P0001';
  END IF;

  deal_id := r.deal_id;
  bank_id := r.bank_id;
  label := r.label;
  RETURN NEXT;
END
$$;

COMMENT ON FUNCTION public.peek_borrower_portal_link IS
  'Read-only state check. Same gate as consume_borrower_portal_link but never marks used_at. Use from any read path (e.g. file commit handlers) that must reject already-consumed links.';

-- ── consume_borrower_portal_link ────────────────────────────────────────
-- Write gate. Same asserts as peek; additionally, for single_use links
-- with NULL used_at, marks used_at = now() inside the same transaction.
-- Locks the row FOR UPDATE so two concurrent consume calls serialize.
CREATE OR REPLACE FUNCTION public.consume_borrower_portal_link(
  p_token text
)
RETURNS TABLE(deal_id uuid, bank_id uuid, label text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  SELECT id, deal_id, bank_id, label, expires_at, used_at, revoked_at, single_use
    INTO r
    FROM public.borrower_portal_links
    WHERE token = p_token
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'link_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF r.revoked_at IS NOT NULL THEN
    RAISE EXCEPTION 'link_revoked' USING ERRCODE = 'P0001';
  END IF;
  IF r.expires_at IS NOT NULL AND r.expires_at <= now() THEN
    RAISE EXCEPTION 'link_expired' USING ERRCODE = 'P0001';
  END IF;
  IF r.single_use AND r.used_at IS NOT NULL THEN
    RAISE EXCEPTION 'link_consumed' USING ERRCODE = 'P0001';
  END IF;

  IF r.single_use AND r.used_at IS NULL THEN
    UPDATE public.borrower_portal_links
      SET used_at = now()
      WHERE id = r.id;
  END IF;

  deal_id := r.deal_id;
  bank_id := r.bank_id;
  label := r.label;
  RETURN NEXT;
END
$$;

COMMENT ON FUNCTION public.consume_borrower_portal_link IS
  'Authoritative single-use gate. Used by the upload page on first arrival. Errors map to HTTP 410 (gone) for the terminal states (expired / consumed / revoked) and 404 (not_found) when the token has no row.';
