-- unused_index (Supabase advisor, INFO, ~918 findings): indexes with
-- zero recorded scans. Every regular btree index has a write-time cost
-- (maintained on every INSERT/UPDATE/DELETE touching its columns) with
-- no read-time benefit if nothing ever queries through it.
--
-- Scoped conservatively: excludes anything backing a PRIMARY KEY or
-- UNIQUE constraint (correctness-critical, never touched regardless of
-- scan count) and anything covering a foreign-key column (kept
-- regardless of scan stats -- FK constraint checks/cascades benefit from
-- these even when pg_stat doesn't attribute a scan to them the same way
-- a planner-chosen index scan does). Only genuinely free-standing,
-- provably-non-constraint, non-FK-covering indexes with idx_scan = 0 are
-- dropped. Verified 0 remaining after applying; guard:tenant-rls,
-- guard:brokerage-rls, guard:rpc-existence all still pass.
DO $$
DECLARE
  r record;
  n_dropped int := 0;
BEGIN
  FOR r IN
    SELECT s.schemaname, s.indexrelname, s.relname AS tablename
    FROM pg_stat_user_indexes s
    JOIN pg_index i ON i.indexrelid = s.indexrelid
    WHERE s.schemaname = 'public' AND s.idx_scan = 0
      AND NOT i.indisprimary AND NOT i.indisunique
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint c
        WHERE c.contype = 'f' AND c.conrelid = i.indrelid
          AND (i.indkey::smallint[])[0:cardinality(c.conkey)-1] = c.conkey
      )
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I.%I', r.schemaname, r.indexrelname);
    n_dropped := n_dropped + 1;
  END LOOP;

  RAISE NOTICE 'Dropped % unused indexes', n_dropped;
END $$;
