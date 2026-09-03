-- deal_collateral_items.advance_rate is a FRACTION of value, never a percentage.
-- -----------------------------------------------------------------------------
-- Every producer and consumer in the app agrees on that unit: CollateralModal
-- writes `Number(input) / 100`, CanonicalMemoTemplate renders `rate * 100`, and
-- computeCollateralFactValues multiplies the item's value by it directly to
-- produce COLLATERAL_NET_VALUE on the credit memo.
--
-- Two production rows nonetheless stored 80 where they meant 0.80, and nothing
-- rejected them — no constraint here, no range check in the code:
--
--   deal 1d7e7c1b (Omnicare 6-18-2026)  ucc_lien     $3,007,506 @ 80
--     → $240,600,480 of "lendable" value on the memo
--   deal c0f6caab (Buff Guys Mobile detailing CRE)  real_estate  $1,200,000 @ 80
--     → $96,000,000
--
-- Both deals are in underwriting. LTV_NET, computed as loan ÷ lendable, read as
-- a hundredth of the truth on both — a deal spectacularly over-collateralised
-- on paper and not at all in fact.
--
-- The repair divides by 100, which is the unit error and nothing more: the
-- banker entered 80%, the app stored the number without scaling it. No rate is
-- invented and no row's intent is guessed at — every out-of-range row in this
-- table holds exactly 80.
--
-- The constraint is the part that lasts. resolveAdvanceRate() now reports an
-- out-of-range rate instead of multiplying by it (src/lib/collateral/
-- collateralTypes.ts), so a bad row can no longer reach a memo — but a bad row
-- should not be storable in the first place.
--
-- Sibling columns were checked and are clean: borrowing_base_calculations
-- .advance_rate (9 rows, all 0.8) and relationship_crypto_collateral_positions
-- .eligible_advance_rate (0 rows).
-- -----------------------------------------------------------------------------

-- Bounded to (1, 100] so this can only ever undo a percent-for-fraction slip.
-- A hypothetical 2.0 is not a mis-scaled 200% and is left for a human.
UPDATE public.deal_collateral_items
SET advance_rate = advance_rate / 100
WHERE advance_rate > 1
  AND advance_rate <= 100;

-- net_lendable_value is a stored derivative of the same rate, but it is NULL on
-- every row in this table today, so the bad rate never reached it and there is
-- nothing to recompute. The memo derives the figure at read time regardless.

ALTER TABLE public.deal_collateral_items
  ADD CONSTRAINT deal_collateral_items_advance_rate_is_fraction
  CHECK (advance_rate IS NULL OR (advance_rate >= 0 AND advance_rate <= 1));

COMMENT ON COLUMN public.deal_collateral_items.advance_rate IS
  'Fraction of estimated_value the bank will lend against, in [0, 1]. 0.70 means 70%. '
  'NEVER a percentage — a row storing 80 multiplied a deal''s collateral by eighty '
  'on the credit memo before the CHECK constraint (2026-09-01) made it unstorable.';
