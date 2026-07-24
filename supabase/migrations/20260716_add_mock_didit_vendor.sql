-- Test-mode support: lets a mock-vendor caller (src/lib/identity/kyc/mockDidit.ts,
-- gated behind BUDDY_MOCK_VENDORS + NODE_ENV !== "production") record
-- vendor = 'mock_didit' instead of 'didit', so a fake identity verification
-- is never indistinguishable from a real one in this table.
--
-- Supersedes an earlier migration (20260715_add_mock_persona_vendor.sql,
-- since removed) that added 'mock_persona' — obsolete now that the
-- Underwriter tenant's vendor swap (commit 396104a0, migration
-- 20260715_signwell_didit_vendor_swap.sql) replaced Persona with Didit
-- everywhere, including the Brokerage mock harness this pass ported onto
-- the new vendor.

BEGIN;

ALTER TABLE public.borrower_identity_verifications
  DROP CONSTRAINT IF EXISTS borrower_identity_verifications_vendor_check;

ALTER TABLE public.borrower_identity_verifications
  ADD CONSTRAINT borrower_identity_verifications_vendor_check
  CHECK (vendor = ANY (ARRAY['didit'::text, 'persona'::text, 'stripe_identity'::text, 'jumio'::text, 'veriff'::text, 'mock_didit'::text]));

COMMIT;
