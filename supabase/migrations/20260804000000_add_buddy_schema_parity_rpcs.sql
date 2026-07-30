BEGIN;

-- ============================================================
-- SPEC-DRIFT-HARDENING-1 D3 — buddy_column_exists / buddy_view_exists RPCs.
--
-- Siblings to the existing public.buddy_table_exists
-- (20260712170941_add_buddy_table_exists_rpc.sql) — same SECURITY DEFINER /
-- STABLE / search_path-locked shape, queried via information_schema, single
-- boolean column returned as a one-row table so callers can use
-- .maybeSingle() and read data.exists.
--
-- Back this admin launch-readiness page's new "Schema Parity" panel
-- (src/app/admin/brokerage/launch-readiness/page.tsx), which reads
-- scripts/audit/schema-manifest.json and, for each entry, confirms the
-- object actually exists live via these RPCs (+ the existing
-- buddy_table_exists for table entries).
--
-- Unlike buddy_table_exists (no explicit REVOKE in its captured DDL), these
-- two explicitly revoke EXECUTE from anon/authenticated: a
-- column/view-existence oracle is schema-enumeration surface with no
-- legitimate client-side caller, and the only caller here
-- (launch-readiness/page.tsx) reads via supabaseAdmin() (service-role),
-- same as buddy_table_exists's own only real caller
-- (franchiseComparator.ts) already does in practice.
-- ============================================================

CREATE OR REPLACE FUNCTION public.buddy_column_exists(p_table_name text, p_column_name text)
RETURNS TABLE("exists" boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = p_table_name
      AND c.column_name = p_column_name
  );
$$;

COMMENT ON FUNCTION public.buddy_column_exists(text, text) IS
  'SPEC-DRIFT-HARDENING-1 D3: column-existence check backing the admin launch-readiness Schema Parity panel. Returns a single-row table with an "exists" boolean column so callers can use .maybeSingle() and read data.exists.';

REVOKE ALL ON FUNCTION public.buddy_column_exists(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.buddy_column_exists(text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buddy_column_exists(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.buddy_view_exists(p_view_name text)
RETURNS TABLE("exists" boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.views v
    WHERE v.table_schema = 'public'
      AND v.table_name = p_view_name
  );
$$;

COMMENT ON FUNCTION public.buddy_view_exists(text) IS
  'SPEC-DRIFT-HARDENING-1 D3: view-existence check backing the admin launch-readiness Schema Parity panel. Returns a single-row table with an "exists" boolean column so callers can use .maybeSingle() and read data.exists.';

REVOKE ALL ON FUNCTION public.buddy_view_exists(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.buddy_view_exists(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.buddy_view_exists(text) TO service_role;

-- ─── Verify ──────────────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM 1 FROM pg_proc
  WHERE proname = 'buddy_column_exists' AND pronamespace = 'public'::regnamespace;
  IF NOT FOUND THEN RAISE EXCEPTION 'buddy_column_exists not created'; END IF;

  PERFORM 1 FROM pg_proc
  WHERE proname = 'buddy_view_exists' AND pronamespace = 'public'::regnamespace;
  IF NOT FOUND THEN RAISE EXCEPTION 'buddy_view_exists not created'; END IF;
END $$;

COMMIT;

-- Reload PostgREST schema cache so the new RPCs become callable without
-- waiting for the periodic auto-reload (~30s).
NOTIFY pgrst, 'reload schema';
