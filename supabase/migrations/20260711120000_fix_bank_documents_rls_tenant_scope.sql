-- Fix bank_documents RLS: the "bank_documents_read_own_bank" policy (added in
-- 20260202000000_bank_documents.sql) was defined as `using (true)`, which does
-- NOT actually scope rows by bank_id despite its name — any row is readable
-- under that policy regardless of the requesting user's bank. App code always
-- reads this table via the service-role client with an explicit
-- .eq("bank_id", bankId) filter, so this has not been exploited in practice,
-- but the policy itself was a false safety net for any future
-- anon/authenticated (non-service-role) access path.
--
-- This mirrors the proven bank_id tenant-scoping pattern ("Pattern A") already
-- used elsewhere in this repo for bank_id-keyed tables — see
-- 20260701_rls_remediation_anon_reachable_tables.sql, which scopes
-- `authenticated` to rows whose bank_id matches the bank_id claim on the
-- request JWT:
--   bank_id::text = COALESCE(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', '')
--
-- NOTE (same disclosure as that migration): the app does not yet mint a
-- bank_id JWT claim, so this `authenticated` policy is dormant
-- defense-in-depth today — all current app access goes through
-- supabaseAdmin() (service_role, which bypasses RLS entirely) with an
-- explicit .eq("bank_id", bankId) filter in application code
-- (see bank-level document library reads in the app). Once/if a bank_id JWT
-- claim is minted for direct-client Supabase access, this policy will start
-- enforcing tenant isolation for real without any further migration.

begin;

drop policy if exists "bank_documents_read_own_bank" on public.bank_documents;

create policy "bank_documents_read_own_bank"
  on public.bank_documents for select
  to authenticated
  using (
    bank_id::text = coalesce(current_setting('request.jwt.claims', true)::jsonb->>'bank_id', '')
  );

-- bank_documents_service_role_all is left unchanged: service_role already
-- bypasses RLS at the role level (rolbypassrls=true), and this policy is a
-- belt-and-suspenders explicit grant matching the pattern used across the
-- rest of this repo's RLS-secured tables.

commit;
