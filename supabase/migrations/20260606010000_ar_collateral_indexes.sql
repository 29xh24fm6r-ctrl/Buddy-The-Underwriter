-- Indexes for AR collateral foreign keys.
-- Without these, any join from reports → customers → invoices → borrowing base does a seq scan.

CREATE INDEX IF NOT EXISTS idx_ar_reports_deal_id ON public.ar_aging_reports(deal_id);
CREATE INDEX IF NOT EXISTS idx_ar_reports_bank_id ON public.ar_aging_reports(bank_id);

CREATE INDEX IF NOT EXISTS idx_ar_customers_report_id ON public.ar_aging_customers(report_id);
CREATE INDEX IF NOT EXISTS idx_ar_customers_deal_id ON public.ar_aging_customers(deal_id);

CREATE INDEX IF NOT EXISTS idx_ar_invoices_report_id ON public.ar_aging_invoices(report_id);
CREATE INDEX IF NOT EXISTS idx_ar_invoices_customer_id ON public.ar_aging_invoices(customer_id);

CREATE INDEX IF NOT EXISTS idx_bb_deal_id ON public.borrowing_base_calculations(deal_id);
CREATE INDEX IF NOT EXISTS idx_bb_report_id ON public.borrowing_base_calculations(report_id);
