-- AR collateral hardening: bank FKs, value-domain CHECKs, updated_at trigger.
-- Idempotent — safe to re-run.

-- ============================================================================
-- bank_id foreign keys → banks(id)
-- ON DELETE CASCADE matches the convention used by bank_assets, bank_memberships, etc.
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ar_aging_reports_bank_id_fkey') THEN
    ALTER TABLE public.ar_aging_reports
      ADD CONSTRAINT ar_aging_reports_bank_id_fkey
      FOREIGN KEY (bank_id) REFERENCES public.banks(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ar_aging_customers_bank_id_fkey') THEN
    ALTER TABLE public.ar_aging_customers
      ADD CONSTRAINT ar_aging_customers_bank_id_fkey
      FOREIGN KEY (bank_id) REFERENCES public.banks(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ar_aging_invoices_bank_id_fkey') THEN
    ALTER TABLE public.ar_aging_invoices
      ADD CONSTRAINT ar_aging_invoices_bank_id_fkey
      FOREIGN KEY (bank_id) REFERENCES public.banks(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'borrowing_base_calculations_bank_id_fkey') THEN
    ALTER TABLE public.borrowing_base_calculations
      ADD CONSTRAINT borrowing_base_calculations_bank_id_fkey
      FOREIGN KEY (bank_id) REFERENCES public.banks(id) ON DELETE CASCADE;
  END IF;
END $$;

-- Also wire deal_id and customer/report FKs that are missing on the breakdown tables.
-- ar_aging_customers.deal_id, ar_aging_invoices.deal_id are bare uuids today.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ar_aging_customers_deal_id_fkey') THEN
    ALTER TABLE public.ar_aging_customers
      ADD CONSTRAINT ar_aging_customers_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ar_aging_invoices_deal_id_fkey') THEN
    ALTER TABLE public.ar_aging_invoices
      ADD CONSTRAINT ar_aging_invoices_deal_id_fkey
      FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ============================================================================
-- CHECK constraints — value domain enforcement
-- ============================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ar_aging_reports_extraction_status_check') THEN
    ALTER TABLE public.ar_aging_reports
      ADD CONSTRAINT ar_aging_reports_extraction_status_check
      CHECK (extraction_status IN ('pending','extracting','complete','failed'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ar_aging_customers_concentration_pct_check') THEN
    ALTER TABLE public.ar_aging_customers
      ADD CONSTRAINT ar_aging_customers_concentration_pct_check
      CHECK (concentration_pct IS NULL OR (concentration_pct >= 0 AND concentration_pct <= 1));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ar_aging_invoices_days_past_due_check') THEN
    ALTER TABLE public.ar_aging_invoices
      ADD CONSTRAINT ar_aging_invoices_days_past_due_check
      CHECK (days_past_due IS NULL OR days_past_due >= 0);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'borrowing_base_advance_rate_check') THEN
    ALTER TABLE public.borrowing_base_calculations
      ADD CONSTRAINT borrowing_base_advance_rate_check
      CHECK (advance_rate IS NULL OR (advance_rate >= 0 AND advance_rate <= 1));
  END IF;
END $$;

-- ============================================================================
-- updated_at trigger on ar_aging_reports
-- Reuses public.set_updated_at() (already defined in earlier migrations).
-- ============================================================================

DROP TRIGGER IF EXISTS ar_aging_reports_set_updated_at ON public.ar_aging_reports;
CREATE TRIGGER ar_aging_reports_set_updated_at
  BEFORE UPDATE ON public.ar_aging_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.set_updated_at();
