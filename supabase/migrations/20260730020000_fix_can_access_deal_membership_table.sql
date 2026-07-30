BEGIN;

-- ============================================================
-- Fix can_access_deal() and the 3 `deals` RLS policies: they check
-- membership against public.bank_user_memberships, a table with 2 rows
-- and zero live writers anywhere in the app. The actual, actively-used
-- membership table — written and read by every real auth/tenant code
-- path (getCurrentBankId(), requireBankAdmin(), tenant/select, admin team
-- management, etc.) — is public.bank_memberships (8 rows today).
--
-- This is not dead code: the research pipeline (runPlanner.ts,
-- normalizeResearchFacts.ts, /api/research/*) queries `deals` and
-- `deal_documents` through a genuine per-user RLS-enforced client
-- (createSupabaseServerClient(), which mints a real Supabase JWT so
-- auth.uid() resolves to the actual signed-in user). Those routes first
-- pass an app-layer gate (ensureDealBankAccess(), which correctly checks
-- bank_memberships via getCurrentBankId()) and only then hit these RLS
-- policies — which independently re-check membership against the stale
-- table. Net effect: for any user not in bank_user_memberships (7 of the
-- app's 8 real memberships, confirmed by direct comparison), the
-- app-layer gate says yes and the RLS-gated query returns nothing. Fails
-- closed (no data leak), but it's a real, live correctness bug — not
-- hypothetical, not dead code.
--
-- Scope: only can_access_deal() and the 3 `deals` policies that were
-- confirmed reachable via a real RLS-enforced client. A broader sweep
-- found 26 other tables (28 policies) that also reference
-- bank_user_memberships, but every real caller of those tables was
-- traced to supabaseAdmin() (service-role, bypasses RLS) — genuinely
-- dead code, left untouched here as agreed.
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_access_deal(p_deal_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1
    from public.deals d
    join public.bank_memberships m
      on m.bank_id = d.bank_id
    where d.id = p_deal_id
      and m.user_id = auth.uid()
  )
  or exists (
    select 1
    from public.platform_admins pa
    where pa.user_id = auth.uid()
  );
$function$;

-- Repoint the 3 `deals` policies at the live table. Reads each policy's
-- current definition from the catalog and performs a targeted textual
-- swap (bank_user_memberships -> bank_memberships) rather than
-- hand-transcribing the qual/with_check text, since these policies were
-- already rewritten once by a prior auth_rls_initplan fix and their exact
-- current text (including any incidental double-wrapping) isn't worth
-- re-deriving by hand — only the table name changes here.
DO $$
DECLARE
  pol RECORD;
  new_qual text;
  new_check text;
  alter_sql text;
BEGIN
  FOR pol IN
    SELECT
      p.polname AS policyname,
      pg_get_expr(p.polqual, p.polrelid) AS qual,
      pg_get_expr(p.polwithcheck, p.polrelid) AS with_check
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'deals'
  LOOP
    new_qual := pol.qual;
    new_check := pol.with_check;

    IF new_qual IS NOT NULL THEN
      new_qual := replace(new_qual, 'FROM bank_user_memberships m', 'FROM bank_memberships m');
    END IF;
    IF new_check IS NOT NULL THEN
      new_check := replace(new_check, 'FROM bank_user_memberships m', 'FROM bank_memberships m');
    END IF;

    IF new_qual IS DISTINCT FROM pol.qual OR new_check IS DISTINCT FROM pol.with_check THEN
      alter_sql := format('ALTER POLICY %I ON public.deals', pol.policyname);
      IF new_qual IS NOT NULL THEN
        alter_sql := alter_sql || format(' USING (%s)', new_qual);
      END IF;
      IF new_check IS NOT NULL THEN
        alter_sql := alter_sql || format(' WITH CHECK (%s)', new_check);
      END IF;
      RAISE NOTICE 'deals policy fix: %', alter_sql;
      EXECUTE alter_sql;
    END IF;
  END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
