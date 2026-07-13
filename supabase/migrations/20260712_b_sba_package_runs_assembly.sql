-- ARC-00 Phase 5 (NEW SPEC S7 4) — 10-tab package assembly output.
BEGIN;

ALTER TABLE public.sba_package_runs
  ADD COLUMN IF NOT EXISTS assembled_package_storage_path text,
  ADD COLUMN IF NOT EXISTS assembled_at timestamptz;

COMMIT;
