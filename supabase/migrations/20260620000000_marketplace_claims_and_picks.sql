-- ============================================================================
-- Sprint 6: Marketplace lender claims + borrower picks + atomic unlock.
--
-- Builds on 20260429_sealing_and_listings.sql:
--   - marketplace_listings already records the listing window + matched lenders.
--   - Lender claim flow (≤ 3 claims, first-come-first-served) lives here.
--   - Borrower pick + atomic unlock (full trident to borrower, full E-Tran
--     package to winning lender, losing lenders lose access) lives here.
-- ============================================================================

-- 1) Lender claims (1 row per lender per listing).
CREATE TABLE IF NOT EXISTS public.marketplace_lender_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  lender_bank_id uuid NOT NULL REFERENCES public.banks(id),

  -- Lifecycle: claimed -> (won | lost | relinquished | expired).
  -- declined = lender explicitly passed (does not count toward the 3-claim cap).
  status text NOT NULL CHECK (status IN (
    'claimed','declined','relinquished','won','lost','expired'
  )),

  claimed_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_reason text,

  claimed_by_user_id text,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Exactly one row per (listing, lender). Prevents double-claim races.
CREATE UNIQUE INDEX IF NOT EXISTS marketplace_lender_claims_listing_lender_unique
  ON public.marketplace_lender_claims (listing_id, lender_bank_id);

CREATE INDEX IF NOT EXISTS marketplace_lender_claims_listing_idx
  ON public.marketplace_lender_claims (listing_id);
CREATE INDEX IF NOT EXISTS marketplace_lender_claims_lender_idx
  ON public.marketplace_lender_claims (lender_bank_id);
CREATE INDEX IF NOT EXISTS marketplace_lender_claims_status_idx
  ON public.marketplace_lender_claims (status);

ALTER TABLE public.marketplace_lender_claims ENABLE ROW LEVEL SECURITY;

-- Brokerage ops sees all claims.
DROP POLICY IF EXISTS lender_claims_select_for_brokerage_ops
  ON public.marketplace_lender_claims;
CREATE POLICY lender_claims_select_for_brokerage_ops
  ON public.marketplace_lender_claims FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    JOIN public.banks b ON b.id = m.bank_id
    WHERE m.user_id = auth.uid() AND b.bank_kind = 'brokerage'
  ));

-- A lender sees only their own claims.
DROP POLICY IF EXISTS lender_claims_select_for_owning_lender
  ON public.marketplace_lender_claims;
CREATE POLICY lender_claims_select_for_owning_lender
  ON public.marketplace_lender_claims FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = marketplace_lender_claims.lender_bank_id
      AND m.user_id = auth.uid()
  ));

COMMENT ON TABLE public.marketplace_lender_claims IS
  'One row per (listing, lender). status=claimed counts toward the 3-claim cap. Inserts go through claim_marketplace_listing() to enforce the cap atomically.';

-- 2) Borrower picks (exactly one active pick per listing).
CREATE TABLE IF NOT EXISTS public.marketplace_borrower_picks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  winning_lender_bank_id uuid NOT NULL REFERENCES public.banks(id),
  picked_at timestamptz NOT NULL DEFAULT now(),
  reverted_at timestamptz,
  revert_reason text
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_borrower_picks_one_active_per_listing
  ON public.marketplace_borrower_picks (listing_id)
  WHERE reverted_at IS NULL;

CREATE INDEX IF NOT EXISTS marketplace_borrower_picks_deal_idx
  ON public.marketplace_borrower_picks (deal_id);

ALTER TABLE public.marketplace_borrower_picks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS borrower_picks_select_for_brokerage_ops
  ON public.marketplace_borrower_picks;
CREATE POLICY borrower_picks_select_for_brokerage_ops
  ON public.marketplace_borrower_picks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    JOIN public.banks b ON b.id = m.bank_id
    WHERE m.user_id = auth.uid() AND b.bank_kind = 'brokerage'
  ));

DROP POLICY IF EXISTS borrower_picks_select_for_winning_lender
  ON public.marketplace_borrower_picks;
CREATE POLICY borrower_picks_select_for_winning_lender
  ON public.marketplace_borrower_picks FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    WHERE m.bank_id = marketplace_borrower_picks.winning_lender_bank_id
      AND m.user_id = auth.uid()
  ));

COMMENT ON TABLE public.marketplace_borrower_picks IS
  'Borrower''s chosen lender. Inserts go through pick_marketplace_winner() which atomically marks losing claims=lost, sets listing.status=picked, and unlocks the winning lender''s full E-Tran view.';

-- 3) Closing fees (per-pick, populated at borrower pick).
CREATE TABLE IF NOT EXISTS public.brokerage_closing_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_id uuid NOT NULL REFERENCES public.marketplace_borrower_picks(id) ON DELETE CASCADE,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  fee_basis text NOT NULL CHECK (fee_basis IN ('flat','bps_of_loan')),
  fee_amount_cents bigint NOT NULL CHECK (fee_amount_cents >= 0),
  fee_bps integer,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','accrued','invoiced','collected','written_off')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS brokerage_closing_fees_deal_idx
  ON public.brokerage_closing_fees (deal_id);
CREATE INDEX IF NOT EXISTS brokerage_closing_fees_status_idx
  ON public.brokerage_closing_fees (status);

ALTER TABLE public.brokerage_closing_fees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS closing_fees_select_for_brokerage_ops
  ON public.brokerage_closing_fees;
CREATE POLICY closing_fees_select_for_brokerage_ops
  ON public.brokerage_closing_fees FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.bank_user_memberships m
    JOIN public.banks b ON b.id = m.bank_id
    WHERE m.user_id = auth.uid() AND b.bank_kind = 'brokerage'
  ));

-- 4) Atomic claim: enforces the ≤3 active-claim cap inside a single statement.
--
-- Returns the new claim row id on success.
-- Raises:
--   - 'listing_not_open'  if the listing is not in 'claiming' status,
--     or claim window is not open right now.
--   - 'claim_cap_reached' if 3 active claims already exist.
--   - 'duplicate_claim'   if this lender already has a non-relinquished claim.
--   - 'not_matched'       if this lender is not in matched_lender_bank_ids.
CREATE OR REPLACE FUNCTION public.claim_marketplace_listing(
  p_listing_id uuid,
  p_lender_bank_id uuid,
  p_user_id text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing record;
  v_active_count int;
  v_existing_status text;
  v_new_id uuid;
BEGIN
  -- Lock the listing row so concurrent claims serialize.
  SELECT id, deal_id, status, claim_opens_at, claim_closes_at, matched_lender_bank_ids
    INTO v_listing
    FROM public.marketplace_listings
    WHERE id = p_listing_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_listing.status <> 'claiming'
     OR now() < v_listing.claim_opens_at
     OR now() > v_listing.claim_closes_at THEN
    RAISE EXCEPTION 'listing_not_open' USING ERRCODE = 'P0001';
  END IF;

  IF NOT (p_lender_bank_id = ANY (v_listing.matched_lender_bank_ids)) THEN
    RAISE EXCEPTION 'not_matched' USING ERRCODE = 'P0001';
  END IF;

  -- Check for prior claim from same lender on same listing.
  SELECT status INTO v_existing_status
    FROM public.marketplace_lender_claims
    WHERE listing_id = p_listing_id
      AND lender_bank_id = p_lender_bank_id;

  IF v_existing_status IS NOT NULL AND v_existing_status NOT IN ('relinquished','declined') THEN
    RAISE EXCEPTION 'duplicate_claim' USING ERRCODE = 'P0001';
  END IF;

  -- Enforce 3-claim cap on active (status=claimed) claims.
  SELECT count(*) INTO v_active_count
    FROM public.marketplace_lender_claims
    WHERE listing_id = p_listing_id
      AND status = 'claimed';

  IF v_active_count >= 3 THEN
    RAISE EXCEPTION 'claim_cap_reached' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.marketplace_lender_claims
    (listing_id, deal_id, lender_bank_id, status, claimed_by_user_id)
  VALUES
    (p_listing_id, v_listing.deal_id, p_lender_bank_id, 'claimed', p_user_id)
  ON CONFLICT (listing_id, lender_bank_id) DO UPDATE
    SET status = 'claimed',
        claimed_at = now(),
        decided_at = NULL,
        decided_reason = NULL,
        claimed_by_user_id = EXCLUDED.claimed_by_user_id,
        updated_at = now()
  RETURNING id INTO v_new_id;

  -- If this fills the cap, the listing is ready for borrower pick.
  IF v_active_count + 1 >= 3 THEN
    UPDATE public.marketplace_listings
       SET status = 'awaiting_borrower_pick',
           updated_at = now()
     WHERE id = p_listing_id
       AND status = 'claiming';
  END IF;

  RETURN v_new_id;
END
$$;

COMMENT ON FUNCTION public.claim_marketplace_listing IS
  'Atomic claim with row-level lock on the listing. Enforces 3-claim cap, matched-lender membership, and one-claim-per-lender. Flips listing to awaiting_borrower_pick when cap is reached.';

-- 5) Atomic pick: borrower selects the winning lender.
--
-- - Marks winning claim status=won, all other claimed rows status=lost.
-- - Flips listing.status = picked, picked_at = now().
-- - Inserts a marketplace_borrower_picks row.
-- - Returns the new pick id.
CREATE OR REPLACE FUNCTION public.pick_marketplace_winner(
  p_listing_id uuid,
  p_winning_lender_bank_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing record;
  v_winning_claim uuid;
  v_new_pick_id uuid;
BEGIN
  SELECT id, deal_id, status
    INTO v_listing
    FROM public.marketplace_listings
    WHERE id = p_listing_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'listing_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_listing.status NOT IN ('claiming','awaiting_borrower_pick') THEN
    RAISE EXCEPTION 'listing_not_pickable' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_winning_claim
    FROM public.marketplace_lender_claims
    WHERE listing_id = p_listing_id
      AND lender_bank_id = p_winning_lender_bank_id
      AND status = 'claimed';

  IF v_winning_claim IS NULL THEN
    RAISE EXCEPTION 'winner_has_no_claim' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.marketplace_lender_claims
     SET status = 'lost',
         decided_at = now(),
         decided_reason = 'borrower picked another lender',
         updated_at = now()
   WHERE listing_id = p_listing_id
     AND status = 'claimed'
     AND id <> v_winning_claim;

  UPDATE public.marketplace_lender_claims
     SET status = 'won',
         decided_at = now(),
         decided_reason = 'borrower pick',
         updated_at = now()
   WHERE id = v_winning_claim;

  UPDATE public.marketplace_listings
     SET status = 'picked',
         picked_at = now(),
         updated_at = now()
   WHERE id = p_listing_id;

  INSERT INTO public.marketplace_borrower_picks
    (listing_id, deal_id, winning_lender_bank_id)
  VALUES
    (p_listing_id, v_listing.deal_id, p_winning_lender_bank_id)
  RETURNING id INTO v_new_pick_id;

  RETURN v_new_pick_id;
END
$$;

COMMENT ON FUNCTION public.pick_marketplace_winner IS
  'Atomic borrower pick: marks winner=won, others=lost, flips listing=picked, inserts pick row. Caller must verify borrower owns the deal (HTTP-only session token).';

-- 6) Public RLS view of "what the lender can see right now" — used by
-- /lender/listings and /lender/claims to avoid duplicating filter logic.
CREATE OR REPLACE VIEW public.marketplace_listings_for_lenders AS
  SELECT
    l.id,
    l.deal_id,
    l.score,
    l.band,
    l.rate_card_tier,
    l.published_rate_bps,
    l.sba_program,
    l.loan_amount,
    l.term_months,
    l.kfs,
    l.kfs_redaction_version,
    l.preview_opens_at,
    l.claim_opens_at,
    l.claim_closes_at,
    l.status,
    l.matched_lender_bank_ids
  FROM public.marketplace_listings l
  WHERE l.status IN ('previewing','claiming','awaiting_borrower_pick');

COMMENT ON VIEW public.marketplace_listings_for_lenders IS
  'Lender-visible projection of marketplace_listings. RLS on the underlying table still applies.';
