-- unindexed_foreign_keys (Supabase advisor, INFO, ~256 findings): FK
-- columns with no covering index are slow for the two things FKs are
-- used for constantly -- checking the referenced row still exists on
-- insert/update of the child, and cascading deletes/updates on the
-- parent (which do a full scan of the child table without an index).
-- Pure additive change: CREATE INDEX IF NOT EXISTS cannot break
-- anything, it only adds a lookup structure.
--
-- Name is a short deterministic hash of (table, constraint name) rather
-- than a truncated concatenation of the table/constraint name -- long
-- table + constraint names exceed Postgres's 63-char identifier limit
-- and truncate to identical prefixes for multiple distinct FKs on the
-- same table, which silently defeats CREATE INDEX IF NOT EXISTS (the
-- 2nd/3rd FK's truncated name collides with the 1st's, so it's treated
-- as already-indexed and skipped). Verified 0 remaining unindexed FKs
-- after applying.
DO $$
DECLARE
  c record;
  cols text;
  idx_name text;
  n_created int := 0;
BEGIN
  FOR c IN
    SELECT conrelid, conname, conkey
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace AND contype = 'f'
      AND NOT EXISTS (
        SELECT 1 FROM pg_index i
        WHERE i.indrelid = pg_constraint.conrelid
          AND (i.indkey::smallint[])[0:cardinality(pg_constraint.conkey)-1] = pg_constraint.conkey
      )
  LOOP
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY k.ord)
    INTO cols
    FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum;

    idx_name := 'idx_fk_' || substr(md5(c.conrelid::text || ':' || c.conname), 1, 24);

    EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON %s (%s)', idx_name, c.conrelid::regclass::text, cols);
    n_created := n_created + 1;
  END LOOP;

  RAISE NOTICE 'Created % foreign-key indexes', n_created;
END $$;
