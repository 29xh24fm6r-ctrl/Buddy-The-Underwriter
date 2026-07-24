-- Recurring SBA/IRS template staleness check (src/lib/jobs/templateStalenessChecker.ts).
-- The ingestion script's own header comment already stated the intended
-- design ("the renderer refuses to fill a form when the stored revision no
-- longer matches the SBA-published current revision list") but nothing had
-- ever implemented the live-vs-stored comparison this depends on. Additive
-- only.

BEGIN;

ALTER TABLE public.bank_document_templates
  ADD COLUMN IF NOT EXISTS last_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_stale boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.bank_document_templates.last_checked_at IS
  'Last time templateStalenessChecker.ts compared this row''s stored revision/sha256 against the live sba.gov/irs.gov source. Null = never checked.';
COMMENT ON COLUMN public.bank_document_templates.is_stale IS
  'true if the last check found the live SBA/IRS PDF differs (revision or sha256) from what is stored in file_path/metadata. Does not by itself block form rendering — see the Drift Log for why that is a deliberate follow-up, not bundled into this migration.';

COMMIT;
