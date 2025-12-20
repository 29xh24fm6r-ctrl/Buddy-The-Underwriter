-- 20251220_deal_display_lookup.sql

-- This function returns best-effort (deal_name, borrower_name) for a list of deal_ids.
-- It auto-detects:
-- - which "deal table" exists (deals, crm_deals, loan_deals)
-- - which deal name column exists (name, deal_name, title)
-- - borrower name directly if present (borrower_name, primary_borrower_name, borrower_display, borrower)
-- - OR via borrower_id join if borrower_id exists and a borrower table exists (borrowers, crm_contacts, contacts, people)

CREATE OR REPLACE FUNCTION public.deal_display_lookup(deal_ids uuid[])
RETURNS TABLE (
  deal_id uuid,
  deal_name text,
  borrower_name text
)
LANGUAGE plpgsql
AS $$
DECLARE
  deal_table regclass;
  deal_table_name text;

  deal_name_col text;
  borrower_name_col text;
  borrower_id_col_exists boolean;

  borrower_table regclass;
  borrower_table_name text;
  borrower_name_join_col text;

  sql text;
BEGIN
  IF deal_ids IS NULL OR array_length(deal_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  -- 1) Pick the first existing deal table from candidates
  deal_table := to_regclass('public.deals');
  IF deal_table IS NULL THEN
    deal_table := to_regclass('public.crm_deals');
  END IF;
  IF deal_table IS NULL THEN
    deal_table := to_regclass('public.loan_deals');
  END IF;

  IF deal_table IS NULL THEN
    -- No deal table found; return empty result
    RETURN;
  END IF;

  SELECT n.nspname || '.' || c.relname
  INTO deal_table_name
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE c.oid = deal_table;

  -- 2) Choose deal name column
  deal_name_col := NULL;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = split_part(deal_table_name, '.', 1)
      AND table_name   = split_part(deal_table_name, '.', 2)
      AND column_name  = 'name'
  ) THEN
    deal_name_col := 'name';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = split_part(deal_table_name, '.', 1)
      AND table_name   = split_part(deal_table_name, '.', 2)
      AND column_name  = 'deal_name'
  ) THEN
    deal_name_col := 'deal_name';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = split_part(deal_table_name, '.', 1)
      AND table_name   = split_part(deal_table_name, '.', 2)
      AND column_name  = 'title'
  ) THEN
    deal_name_col := 'title';
  END IF;

  -- 3) Prefer borrower name directly on the deal table if it exists
  borrower_name_col := NULL;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = split_part(deal_table_name, '.', 1)
      AND table_name   = split_part(deal_table_name, '.', 2)
      AND column_name  = 'borrower_name'
  ) THEN
    borrower_name_col := 'borrower_name';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = split_part(deal_table_name, '.', 1)
      AND table_name   = split_part(deal_table_name, '.', 2)
      AND column_name  = 'primary_borrower_name'
  ) THEN
    borrower_name_col := 'primary_borrower_name';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = split_part(deal_table_name, '.', 1)
      AND table_name   = split_part(deal_table_name, '.', 2)
      AND column_name  = 'borrower_display'
  ) THEN
    borrower_name_col := 'borrower_display';
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = split_part(deal_table_name, '.', 1)
      AND table_name   = split_part(deal_table_name, '.', 2)
      AND column_name  = 'borrower'
  ) THEN
    borrower_name_col := 'borrower';
  END IF;

  -- 4) Check if borrower_id exists for join-based borrower lookup
  borrower_id_col_exists := EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = split_part(deal_table_name, '.', 1)
      AND table_name   = split_part(deal_table_name, '.', 2)
      AND column_name  = 'borrower_id'
  );

  -- 5) If no borrower_name column, attempt join to a borrower/contact table
  borrower_table := NULL;
  borrower_name_join_col := NULL;

  IF borrower_name_col IS NULL AND borrower_id_col_exists THEN
    borrower_table := to_regclass('public.borrowers');
    IF borrower_table IS NULL THEN
      borrower_table := to_regclass('public.crm_contacts');
    END IF;
    IF borrower_table IS NULL THEN
      borrower_table := to_regclass('public.contacts');
    END IF;
    IF borrower_table IS NULL THEN
      borrower_table := to_regclass('public.people');
    END IF;

    IF borrower_table IS NOT NULL THEN
      SELECT n.nspname || '.' || c.relname
      INTO borrower_table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.oid = borrower_table;

      -- pick a name column on borrower table
      IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = split_part(borrower_table_name, '.', 1)
          AND table_name   = split_part(borrower_table_name, '.', 2)
          AND column_name  = 'name'
      ) THEN
        borrower_name_join_col := 'name';
      ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = split_part(borrower_table_name, '.', 1)
          AND table_name   = split_part(borrower_table_name, '.', 2)
          AND column_name  = 'full_name'
      ) THEN
        borrower_name_join_col := 'full_name';
      ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = split_part(borrower_table_name, '.', 1)
          AND table_name   = split_part(borrower_table_name, '.', 2)
          AND column_name  = 'display_name'
      ) THEN
        borrower_name_join_col := 'display_name';
      ELSIF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = split_part(borrower_table_name, '.', 1)
          AND table_name   = split_part(borrower_table_name, '.', 2)
          AND column_name  = 'legal_name'
      ) THEN
        borrower_name_join_col := 'legal_name';
      END IF;
    END IF;
  END IF;

  -- 6) Build query dynamically
  -- deal_name expression
  -- if no known deal name column, return NULL
  -- borrower_name expression:
  -- - direct borrower name column if present
  -- - else join borrower table on borrower_id if possible
  sql := 'SELECT d.id as deal_id, ';

  IF deal_name_col IS NOT NULL THEN
    sql := sql || format('d.%I::text as deal_name, ', deal_name_col);
  ELSE
    sql := sql || 'NULL::text as deal_name, ';
  END IF;

  IF borrower_name_col IS NOT NULL THEN
    sql := sql || format('d.%I::text as borrower_name ', borrower_name_col);
    sql := sql || format('FROM %s d ', deal_table_name);
  ELSIF borrower_table IS NOT NULL AND borrower_name_join_col IS NOT NULL THEN
    sql := sql || format('b.%I::text as borrower_name ', borrower_name_join_col);
    sql := sql || format('FROM %s d LEFT JOIN %s b ON b.id = d.borrower_id ', deal_table_name, borrower_table_name);
  ELSE
    sql := sql || 'NULL::text as borrower_name ';
    sql := sql || format('FROM %s d ', deal_table_name);
  END IF;

  sql := sql || 'WHERE d.id = ANY($1)';

  RETURN QUERY EXECUTE sql USING deal_ids;
END;
$$;

-- Helpful index suggestion (no-op if already indexed)
-- Most deal tables already have PK on id; borrower tables usually do too.
