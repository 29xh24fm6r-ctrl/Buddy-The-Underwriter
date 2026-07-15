-- Test-mode support: lets a mock-vendor caller (src/lib/identity/kyc/mockPersona.ts,
-- gated behind BUDDY_MOCK_VENDORS + NODE_ENV !== "production") record
-- vendor = 'mock_persona' instead of 'persona', so a fake identity
-- verification is never indistinguishable from a real one in this table.

BEGIN;

ALTER TABLE public.borrower_identity_verifications
  DROP CONSTRAINT IF EXISTS borrower_identity_verifications_vendor_check;

ALTER TABLE public.borrower_identity_verifications
  ADD CONSTRAINT borrower_identity_verifications_vendor_check
  CHECK (vendor = ANY (ARRAY['didit'::text, 'persona'::text, 'stripe_identity'::text, 'jumio'::text, 'veriff'::text, 'mock_persona'::text]));

COMMIT;
