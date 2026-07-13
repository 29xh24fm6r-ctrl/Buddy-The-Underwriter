-- SPEC S2 A-1 — deal_loan_requests columns referenced by the S1 SOP 50 10 8
-- rule set (seller note equity/standby, working capital justification/lien,
-- franchise linkage, equity injection + total project cost).
BEGIN;
ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS seller_note_equity_portion numeric,
  ADD COLUMN IF NOT EXISTS seller_note_full_standby boolean,
  ADD COLUMN IF NOT EXISTS working_capital_justification text,
  ADD COLUMN IF NOT EXISTS lien_on_all_fixed_assets boolean,
  ADD COLUMN IF NOT EXISTS franchise_brand_id uuid REFERENCES public.franchise_brands(id),
  ADD COLUMN IF NOT EXISTS equity_injection_amount numeric,
  ADD COLUMN IF NOT EXISTS total_project_cost numeric;
COMMIT;
