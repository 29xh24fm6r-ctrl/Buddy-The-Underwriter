-- ARC-00 Phase 4 (NEW SPEC S6) — 504 project-cost-split columns.
-- AP-3: confirmed via information_schema — deal_loan_requests has
-- total_project_cost/injection_amount/injection_source but nothing
-- representing the 504 50/40/10 structure (third-party lender / CDC
-- debenture / borrower contribution). Additive, nullable — surfaced as a
-- gap via the normal missing-fields mechanism when absent, never defaulted.
BEGIN;

ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS third_party_lender_amount numeric,
  ADD COLUMN IF NOT EXISTS cdc_debenture_amount numeric,
  ADD COLUMN IF NOT EXISTS borrower_contribution_amount numeric,
  ADD COLUMN IF NOT EXISTS occupancy_percentage numeric,
  ADD COLUMN IF NOT EXISTS creates_or_retains_jobs boolean,
  ADD COLUMN IF NOT EXISTS jobs_created_count integer,
  ADD COLUMN IF NOT EXISTS jobs_retained_count integer,
  ADD COLUMN IF NOT EXISTS meets_public_policy_goal boolean,
  ADD COLUMN IF NOT EXISTS public_policy_goal_description text,
  ADD COLUMN IF NOT EXISTS includes_debt_refinance boolean,
  ADD COLUMN IF NOT EXISTS debt_refinance_amount numeric;

COMMIT;
