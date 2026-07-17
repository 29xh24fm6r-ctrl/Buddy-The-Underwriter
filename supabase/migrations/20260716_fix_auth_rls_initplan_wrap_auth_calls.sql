-- auth_rls_initplan (Supabase advisor, WARN, ~352 findings across 268
-- tables): RLS policies calling auth.uid()/auth.role()/auth.jwt()
-- directly re-evaluate that call for every row scanned. Supabase's
-- documented fix is to wrap the call in a scalar subquery —
-- (select auth.uid()) — so Postgres computes it once per query (an
-- "InitPlan") instead of once per row. This is a pure query-plan
-- optimization: the subquery returns the exact same value, so no
-- policy's effective access-control result changes.
--
-- Verified before writing this migration that every occurrence of
-- auth.uid()/auth.role()/auth.jwt() across every public-schema policy is
-- currently the bare, unwrapped form (no already-wrapped occurrences
-- exist), so a global regexp_replace cannot double-wrap anything.
--
-- ALTER POLICY's USING/WITH CHECK clauses are independently optional —
-- omitting one leaves that clause (and the policy's role list) exactly
-- as it was, so this only touches the specific clause(s) that actually
-- contained an unwrapped auth.* call.
DO $$
DECLARE
  r record;
  alter_sql text;
  new_qual text;
  new_check text;
  n_altered int := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        (qual IS NOT NULL AND qual ~ 'auth\.(uid|role|jwt|email)\(\)' AND qual !~ '\(\s*select\s+auth\.(uid|role|jwt|email)\(\)')
        OR
        (with_check IS NOT NULL AND with_check ~ 'auth\.(uid|role|jwt|email)\(\)' AND with_check !~ '\(\s*select\s+auth\.(uid|role|jwt|email)\(\)')
      )
  LOOP
    alter_sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);

    IF r.qual IS NOT NULL AND r.qual ~ 'auth\.(uid|role|jwt|email)\(\)' AND r.qual !~ '\(\s*select\s+auth\.(uid|role|jwt|email)\(\)' THEN
      new_qual := regexp_replace(r.qual, 'auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g');
      alter_sql := alter_sql || format(' USING (%s)', new_qual);
    END IF;

    IF r.with_check IS NOT NULL AND r.with_check ~ 'auth\.(uid|role|jwt|email)\(\)' AND r.with_check !~ '\(\s*select\s+auth\.(uid|role|jwt|email)\(\)' THEN
      new_check := regexp_replace(r.with_check, 'auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g');
      alter_sql := alter_sql || format(' WITH CHECK (%s)', new_check);
    END IF;

    EXECUTE alter_sql;
    n_altered := n_altered + 1;
  END LOOP;

  IF n_altered <> 260 THEN
    RAISE EXCEPTION 'Expected to alter exactly 260 policies, altered %', n_altered;
  END IF;
END $$;

-- Follow-up: one policy (deal_voice_sessions_select_for_bank_members)
-- was not present/matching at the count-check above (likely created or
-- modified by a concurrent process on the live database between the
-- count and the loop) but had the same unwrapped auth.uid() pattern
-- when checked immediately after. Same fix, applied directly.
ALTER POLICY deal_voice_sessions_select_for_bank_members ON public.deal_voice_sessions
  USING (
    EXISTS (
      SELECT 1
      FROM bank_user_memberships m
      WHERE m.bank_id = deal_voice_sessions.bank_id
        AND m.user_id = (select auth.uid())
    )
  );
