-- Remaining AR collateral indexes.
-- bank_id is hit by RLS on every row read; invoice queries filter by deal_id.

CREATE INDEX IF NOT EXISTS idx_ar_customers_bank_id
  ON public.ar_aging_customers(bank_id);

CREATE INDEX IF NOT EXISTS idx_ar_invoices_bank_id
  ON public.ar_aging_invoices(bank_id);

CREATE INDEX IF NOT EXISTS idx_ar_invoices_deal_id
  ON public.ar_aging_invoices(deal_id);

CREATE INDEX IF NOT EXISTS idx_bb_bank_id
  ON public.borrowing_base_calculations(bank_id);
