-- Flag engine unique constraint for idempotent upserts
-- Constraint on (deal_id, trigger_type, year_observed) — same trigger can fire for different years.
-- For flags where year_observed is not applicable, use year_observed = 0 as sentinel.

ALTER TABLE deal_flags
  ADD CONSTRAINT uq_deal_flags_deal_trigger_year
  UNIQUE (deal_id, trigger_type, year_observed);
