-- Applied live via MCP apply_migration as fix_deal_voice_sessions_rls_tenant_isolation.
-- This file is a tracked record of that change (see supabase/migrations/README.md
-- for why local file version prefixes don't match remote schema_migrations here).
--
-- deal_voice_sessions.bank_rls was a tautology, not an access-control check:
-- it only asserted the row's own bank_id matched its own deal_id's bank,
-- which is true for every well-formed row regardless of who is asking.
-- It also applied to `public` (anon included), so any holder of the
-- publishable anon key could read every bank's voice-session rows directly
-- via PostgREST — deal_id, bank_id, metadata, borrower_session_token_hash,
-- across every tenant, bypassing the Next.js app entirely.
--
-- Replace it with the same auth.uid()+bank-membership pattern already used
-- correctly on the sibling table voice_session_audits
-- (voice_session_audits_select_for_bank_members), created in the same
-- original feature migration (20260424_borrower_voice.sql).
--
-- Writes to this table only ever happen via the service-role client
-- (buddy-voice-gateway, Next.js API routes using supabaseAdmin()), which
-- bypasses RLS entirely — so restricting the public-facing policy to
-- SELECT-for-bank-members (no INSERT/UPDATE/DELETE policy for
-- anon/authenticated) matches existing app behavior with no functional
-- change, only closing the direct-REST-API exposure.

drop policy if exists "bank_rls" on public.deal_voice_sessions;

create policy "deal_voice_sessions_select_for_bank_members"
on public.deal_voice_sessions
for select
using (
  exists (
    select 1
    from bank_user_memberships m
    where m.bank_id = deal_voice_sessions.bank_id
      and m.user_id = auth.uid()
  )
);
