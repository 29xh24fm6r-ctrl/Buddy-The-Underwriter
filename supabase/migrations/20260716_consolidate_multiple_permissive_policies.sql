-- multiple_permissive_policies (Supabase advisor, WARN, ~1626 findings,
-- 81 tables): when 2+ PERMISSIVE policies apply to the same role for the
-- same command, Postgres evaluates every one of them and ORs the results
-- together at execution time -- for every row. This consolidates each
-- group of overlapping PERMISSIVE policies (grouped by exact role-array
-- match, so no role ever gains or loses applicability) into exactly one
-- policy per command (SELECT/INSERT/UPDATE/DELETE), whose condition is
-- the OR of every source policy's condition for that command --
-- mathematically identical to what Postgres already computes today, just
-- evaluated once instead of N times per row.
--
-- Only PERMISSIVE policies are touched (grouping filters on
-- permissive='PERMISSIVE'); RESTRICTIVE policies are untouched and
-- continue to AND against the result exactly as before. Only groups
-- sharing an EXACT role-array match are merged together -- two policies
-- with different (even overlapping) role lists are never combined, so a
-- role can never end up newly subject to a condition that didn't apply
-- to it before.
--
-- Verified before applying: 100 groups, 236 source policies. Verified
-- after applying: 0 remaining multi-policy overlaps, 367 merged policies
-- (201 groups with real overlap + 166 single-source groups, matching a
-- pre-computed dry run exactly), guard:tenant-rls and
-- guard:brokerage-rls both pass, and a functional spot-check across 5
-- representative tables (deal_timeline_events, deal_mitigants,
-- ai_events, deal_interview_sessions, bank_user_memberships) under a
-- simulated `authenticated` role + JWT still enforces deny-by-default
-- correctly.
--
-- NOTE (not fixed here, flagging separately): the pre-existing
-- deal_mitigants_write_admin policy contained a self-referential
-- tautology (`m.bank_id = m.bank_id` instead of
-- `m.bank_id = deal_mitigants.bank_id`), which this migration preserves
-- byte-for-byte inside the merged OR clause rather than silently
-- "fixing" as a side effect of a mechanical consolidation.
DO $$
DECLARE
  g record;
  cmd_name text;
  src record;
  using_list text[];
  check_list text[];
  role_clause text;
  new_using text;
  new_check text;
  policy_sql text;
  n_groups int := 0;
  n_dropped int := 0;
  n_created int := 0;
BEGIN
  FOR g IN
    SELECT tablename, roles
    FROM pg_policies
    WHERE schemaname = 'public' AND permissive = 'PERMISSIVE'
    GROUP BY tablename, roles
    HAVING count(*) > 1
  LOOP
    n_groups := n_groups + 1;

    IF g.roles = ARRAY['public']::name[] THEN
      role_clause := 'PUBLIC';
    ELSE
      SELECT string_agg(quote_ident(r), ', ') INTO role_clause FROM unnest(g.roles) AS r;
    END IF;

    FOREACH cmd_name IN ARRAY ARRAY['SELECT','INSERT','UPDATE','DELETE']
    LOOP
      using_list := ARRAY[]::text[];
      check_list := ARRAY[]::text[];

      FOR src IN
        SELECT qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public' AND tablename = g.tablename AND roles = g.roles
          AND permissive = 'PERMISSIVE' AND cmd IN ('ALL', cmd_name)
      LOOP
        IF cmd_name IN ('SELECT','UPDATE','DELETE') AND src.qual IS NOT NULL AND NOT (src.qual = ANY(using_list)) THEN
          using_list := using_list || src.qual;
        END IF;
        IF cmd_name IN ('INSERT','UPDATE') THEN
          IF coalesce(src.with_check, src.qual) IS NOT NULL AND NOT (coalesce(src.with_check, src.qual) = ANY(check_list)) THEN
            check_list := check_list || coalesce(src.with_check, src.qual);
          END IF;
        END IF;
      END LOOP;

      IF array_length(using_list, 1) IS NULL AND array_length(check_list, 1) IS NULL THEN
        CONTINUE;
      END IF;

      SELECT string_agg('(' || x || ')', ' OR ') INTO new_using FROM unnest(using_list) AS x;
      SELECT string_agg('(' || x || ')', ' OR ') INTO new_check FROM unnest(check_list) AS x;

      policy_sql := format(
        'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR %s TO %s',
        g.tablename || '_' || lower(cmd_name) || '_merged',
        g.tablename,
        cmd_name,
        role_clause
      );
      IF new_using IS NOT NULL THEN
        policy_sql := policy_sql || format(' USING (%s)', new_using);
      END IF;
      IF new_check IS NOT NULL THEN
        policy_sql := policy_sql || format(' WITH CHECK (%s)', new_check);
      END IF;

      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', g.tablename || '_' || lower(cmd_name) || '_merged', g.tablename);
      EXECUTE policy_sql;
      n_created := n_created + 1;
    END LOOP;

    FOR src IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = g.tablename AND roles = g.roles AND permissive = 'PERMISSIVE'
        AND policyname NOT LIKE '%\_merged'
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', src.policyname, g.tablename);
      n_dropped := n_dropped + 1;
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Consolidated % groups: dropped % original policies, created % merged policies', n_groups, n_dropped, n_created;

  IF n_groups <> 100 THEN
    RAISE EXCEPTION 'Expected 100 groups, found %', n_groups;
  END IF;
  IF n_dropped <> 236 THEN
    RAISE EXCEPTION 'Expected to drop 236 original policies, dropped %', n_dropped;
  END IF;
END $$;
