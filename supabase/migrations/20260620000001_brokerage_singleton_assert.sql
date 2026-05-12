-- ============================================================================
-- Brokerage singleton invariant.
--
-- Spec: SPEC-BROKERAGE-PRODUCTIONIZATION-V1 §Phase 1.
--
-- The existing 20260425_brokerage_tenant_model.sql seeded exactly one bank
-- row with bank_kind='brokerage' (code='BUDDY_BROKERAGE'). This migration
-- adds the structural guard so accidental inserts of additional brokerage
-- rows fail loudly at the DB level — the application's getBrokerageBankId()
-- relies on the at-most-one invariant.
--
-- Idempotent: re-running is a no-op (CREATE UNIQUE INDEX IF NOT EXISTS).
-- Does NOT modify lender tenants.
-- ============================================================================

-- Ensure exactly one bank may carry bank_kind='brokerage'.
CREATE UNIQUE INDEX IF NOT EXISTS banks_brokerage_singleton_idx
  ON public.banks ((bank_kind))
  WHERE bank_kind = 'brokerage';

COMMENT ON INDEX public.banks_brokerage_singleton_idx IS
  'Singleton guard for the Buddy Brokerage tenant. At most one row in banks may have bank_kind=brokerage. Application code resolves the row id via src/lib/tenant/brokerage.ts.';

-- Idempotent safety insert: if some environment lost the brokerage row,
-- re-create it. The unique index above blocks accidental duplicates.
INSERT INTO public.banks (code, name, bank_kind, is_sandbox)
SELECT 'BUDDY_BROKERAGE', 'Buddy Brokerage', 'brokerage', false
WHERE NOT EXISTS (
  SELECT 1 FROM public.banks WHERE bank_kind = 'brokerage'
);
