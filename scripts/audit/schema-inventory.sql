-- SPEC-SYSTEM-DEBLOAT-1 Phase C1 — schema inventory data source.
--
-- Read-only. No DDL. Produces the DB-side columns behind
-- docs/audit/schema-inventory-2026-07.md: real row counts, FK edges, view/
-- matview dependencies, function references, and RLS policy counts for
-- every table pg_stat_user_tables reports as empty.
--
-- Migration-file authorship and code-reference counts are NOT computable in
-- SQL (they're filesystem lookups against this repo, not the database) —
-- those were produced by grepping supabase/migrations/*.sql and src/ +
-- services/ + scripts/ locally. See the doc's "Methodology" section for the
-- exact patterns used.
--
-- IMPORTANT — read this before trusting n_live_tup=0 as "empty":
-- n_live_tup is a planner-statistics estimate populated by autovacuum/
-- ANALYZE, not a live row count. As of 2026-07-29, 81 of the 564 tables this
-- reports as empty actually contain data (74,976 rows total; worst case
-- franchise_sba_directory_snapshots at 32,433). Section 2 below re-checks
-- every candidate with an actual count(*) — always run it before acting on
-- section 1 alone.

-- ============================================================
-- 1. Structural signals: FK edges, view/matview deps, function refs, RLS.
-- ============================================================
WITH empty_tables AS (
  SELECT relname AS table_name
  FROM pg_stat_user_tables
  WHERE schemaname = 'public' AND n_live_tup = 0
),
fk_inbound AS (
  SELECT c.confrelid::regclass::text AS full_name, count(*) AS n
  FROM pg_constraint c
  WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
  GROUP BY c.confrelid
),
fk_outbound AS (
  SELECT c.conrelid::regclass::text AS full_name, count(*) AS n
  FROM pg_constraint c
  WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
  GROUP BY c.conrelid
),
view_refs AS (
  SELECT dep_table.relname AS table_name, count(DISTINCT v.oid) AS n
  FROM pg_depend d
  JOIN pg_rewrite r ON r.oid = d.objid
  JOIN pg_class v ON v.oid = r.ev_class AND v.relkind IN ('v','m')
  JOIN pg_class dep_table ON dep_table.oid = d.refobjid AND dep_table.relkind = 'r'
    AND dep_table.relnamespace = 'public'::regnamespace
  WHERE v.oid <> dep_table.oid
  GROUP BY dep_table.relname
),
fn_refs AS (
  -- Word-boundary substring match against function source. Can false-positive
  -- on a comment mentioning the table name, and can miss a function that
  -- builds the table name dynamically (format('... %I ...', var)).
  SELECT et.table_name, count(DISTINCT p.oid) AS n
  FROM empty_tables et
  JOIN pg_proc p ON p.pronamespace = 'public'::regnamespace
    AND p.prosrc ~* ('[^a-zA-Z0-9_]' || et.table_name || '[^a-zA-Z0-9_]')
  GROUP BY et.table_name
),
rls_counts AS (
  SELECT tablename AS table_name, count(*) AS n
  FROM pg_policies
  WHERE schemaname = 'public'
  GROUP BY tablename
)
SELECT et.table_name,
       coalesce(fi.n,0) AS fk_inbound,
       coalesce(fo.n,0) AS fk_outbound,
       coalesce(vr.n,0) AS view_refs,
       coalesce(fr.n,0) AS fn_refs,
       coalesce(rl.n,0) AS rls_policies
FROM empty_tables et
LEFT JOIN fk_inbound fi ON fi.full_name = 'public.' || et.table_name
LEFT JOIN fk_outbound fo ON fo.full_name = 'public.' || et.table_name
LEFT JOIN view_refs vr ON vr.table_name = et.table_name
LEFT JOIN fn_refs fr ON fr.table_name = et.table_name
LEFT JOIN rls_counts rl ON rl.table_name = et.table_name
ORDER BY et.table_name;

-- ============================================================
-- 2. Real row counts — DO NOT SKIP. n_live_tup=0 is not proof of "empty".
--    Uses a session-scoped TEMP TABLE (not persistent DDL) to hold the
--    result of a dynamic count(*) loop, since Postgres has no built-in way
--    to aggregate count(*) across a dynamic table list in a single
--    non-procedural statement.
-- ============================================================
CREATE TEMP TABLE tmp_real_counts (table_name text, real_count bigint);
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT relname FROM pg_stat_user_tables WHERE schemaname='public' AND n_live_tup = 0 LOOP
    EXECUTE format('INSERT INTO tmp_real_counts SELECT %L, count(*) FROM %I', t, t);
  END LOOP;
END $$;

SELECT table_name, real_count
FROM tmp_real_counts
ORDER BY table_name;

-- Quick sanity summary — compare against docs/audit/schema-inventory-2026-07.md
-- when re-running this to detect drift since the doc was generated.
SELECT
  count(*) AS tables_checked,
  count(*) FILTER (WHERE real_count > 0) AS tables_actually_have_rows,
  sum(real_count) AS total_rows_found
FROM tmp_real_counts;
