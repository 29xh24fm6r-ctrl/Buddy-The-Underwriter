-- Post-Confirm Snapshot Integrity: Add deferred_post_confirm to artifact status taxonomy
--
-- Deferred is intentional. Deferred is auditable. Deferred is not classified.
-- Late artifacts that arrive after intake seal are truthfully deferred —
-- classification did not occur. Buddy never lies in state.

ALTER TABLE public.document_artifacts
  DROP CONSTRAINT IF EXISTS document_artifacts_status_check;

ALTER TABLE public.document_artifacts
  ADD CONSTRAINT document_artifacts_status_check
  CHECK (status IN (
    'queued',
    'processing',
    'classified',
    'extracted',
    'matched',
    'failed',
    'deferred_post_confirm'
  ));
