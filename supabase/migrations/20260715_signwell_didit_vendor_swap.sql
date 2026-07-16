BEGIN;

-- ============================================================
-- Vendor swap: DocuSeal -> SignWell (e-signature), Persona -> Didit (KYC).
-- Both prior vendors were built but never provisioned/deployed in any
-- environment (see docs/build-logs/ARC00_VENDOR_PROVISIONING_CHECKLIST.md);
-- 0 rows exist in either table as of this migration, so columns are
-- renamed in place rather than added alongside dead ones.
--
-- The IAL2 gate, RLS policies, deal_events audit trail, and staleness
-- tracking this replaces nothing about — only the two vendor-specific
-- columns on signed_documents and the vendor CHECK on
-- borrower_identity_verifications change.
-- ============================================================

-- signed_documents: DocuSeal-specific column names -> vendor-neutral names.
-- SignWell's "Audit & Lock" feature appends the audit trail as a page
-- inside the completed PDF itself rather than producing a separate
-- downloadable artifact the way DocuSeal's audit_log_url does — so
-- audit_trail_storage_path becomes nullable; SignWell-provider rows leave
-- it null and rely on signed_pdf_storage_path holding the audit-inclusive
-- PDF. A future vendor that does provide a separate audit file can still
-- populate it.
ALTER TABLE public.signed_documents
  ADD COLUMN IF NOT EXISTS esign_provider text NOT NULL DEFAULT 'signwell';

ALTER TABLE public.signed_documents RENAME COLUMN docuseal_submission_id TO esign_document_id;
ALTER TABLE public.signed_documents RENAME COLUMN docuseal_submitter_id TO esign_signer_id;

ALTER TABLE public.signed_documents ALTER COLUMN audit_trail_storage_path DROP NOT NULL;

COMMENT ON COLUMN public.signed_documents.esign_provider IS
  'E-signature vendor that produced this signed document (default signwell).';
COMMENT ON COLUMN public.signed_documents.esign_document_id IS
  'Vendor document id (SignWell document id; formerly docuseal_submission_id).';
COMMENT ON COLUMN public.signed_documents.esign_signer_id IS
  'Vendor recipient/signer id within the document (formerly docuseal_submitter_id).';
COMMENT ON COLUMN public.signed_documents.audit_trail_storage_path IS
  'Separate audit-trail artifact path, when the vendor provides one. Null for SignWell, whose Audit & Lock trail is embedded in signed_pdf_storage_path.';

-- borrower_identity_verifications: add didit as a supported vendor and make
-- it the default going forward; keep the prior options for vendor
-- neutrality (principle #18) even though none have live rows today.
ALTER TABLE public.borrower_identity_verifications
  DROP CONSTRAINT borrower_identity_verifications_vendor_check;
ALTER TABLE public.borrower_identity_verifications
  ADD CONSTRAINT borrower_identity_verifications_vendor_check
  CHECK (vendor IN ('didit', 'persona', 'stripe_identity', 'jumio', 'veriff'));
ALTER TABLE public.borrower_identity_verifications ALTER COLUMN vendor SET DEFAULT 'didit';

COMMIT;
