-- Read-only role for CI schema drift detection (SD-C).
--
-- Scope: SELECT on metadata catalogs only. NO access to public.* application
-- tables. Used by .github/workflows/ci.yml "Schema drift detection" step via
-- the DRIFT_DETECT_DB_URL secret.
--
-- Spec: specs/schema-drift/SPEC-SD-C-ci-drift-detection.md §C-1
-- Runbook: infrastructure/drift-detection/RUNBOOK.md
--
-- Provisioning (manual, OUT-OF-BAND, after this migration applies):
--   1. Apply this migration via the Supabase dashboard.
--   2. Connect as superuser:
--        ALTER ROLE drift_reader PASSWORD '<random-32-char>';
--   3. Construct the connection URL:
--        postgres://drift_reader:<password>@<host>:5432/postgres?sslmode=require
--   4. Add as DRIFT_DETECT_DB_URL GitHub repo secret.
--
-- The placeholder password literal below is intentional. Never commit a real
-- password to git, even in a migration. Rotation is intentionally out-of-band.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'drift_reader') THEN
    CREATE ROLE drift_reader WITH LOGIN PASSWORD 'CHANGE_ME_AT_PROVISION_TIME';
  END IF;
END $$;

-- Strict scope: metadata catalogs + migration history only.
GRANT USAGE ON SCHEMA information_schema TO drift_reader;
GRANT USAGE ON SCHEMA pg_catalog TO drift_reader;
GRANT USAGE ON SCHEMA supabase_migrations TO drift_reader;
GRANT SELECT ON supabase_migrations.schema_migrations TO drift_reader;

-- information_schema and pg_catalog are SELECT-by-default once USAGE is
-- granted; nothing more is needed there.

-- Defensive REVOKEs on application schema. Make scope intent obvious to any
-- future operator inspecting role privileges.
REVOKE ALL ON SCHEMA public FROM drift_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM drift_reader;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM drift_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM drift_reader;

-- Ensure future tables/sequences/functions in public do not silently grant
-- access to drift_reader.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON TABLES FROM drift_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM drift_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL ON FUNCTIONS FROM drift_reader;

COMMIT;
