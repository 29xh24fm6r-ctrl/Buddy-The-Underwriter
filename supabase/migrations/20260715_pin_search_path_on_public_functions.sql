-- function_search_path_mutable (Supabase advisor, WARN, 88 findings):
-- 88 application-owned functions in `public` had no explicitly pinned
-- search_path. A mutable search_path is a known Postgres privilege-
-- escalation vector for SECURITY DEFINER functions in particular — a
-- caller who can create objects earlier in their effective search_path
-- (e.g. a same-named function/table in a schema that resolves before
-- `public`) can potentially hijack an unqualified reference inside the
-- function body to run with the function owner's privileges.
--
-- This pins search_path = public, pg_temp on exactly the 88
-- application-owned functions the advisor flagged (confirmed by exact
-- count match before applying) — explicitly excludes any function owned
-- by an extension (pgvector, pg_trgm), which must not be altered here.
-- Pinning to the same schema these functions already implicitly depend
-- on does not change behavior; it only removes the ambiguity.
DO $$
DECLARE
  r record;
  n_altered int := 0;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
    WHERE ns.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) cfg WHERE cfg LIKE 'search_path=%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, pg_temp', r.proname, r.args);
    n_altered := n_altered + 1;
  END LOOP;

  IF n_altered <> 88 THEN
    RAISE EXCEPTION 'Expected to alter exactly 88 functions, altered %', n_altered;
  END IF;
END $$;
