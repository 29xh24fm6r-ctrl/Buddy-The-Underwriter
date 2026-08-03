-- §3.C — Character question explicit confirmation tracking.
--
-- An LLM must not infer a criminal-history answer from conversational text.
-- Extraction may pre-fill the ownership_entities column; only an explicit
-- borrower action (clicking "I confirm this answer") creates a row here.
-- The completeness gate (§7) requires BOTH the column value AND a
-- confirmation row before marking a character question as answered.
--
-- RLS CORRECTION (audit 2026-08-01): this policy was originally
--
--   create policy "service_role_all" on character_question_confirmations
--     for all using (true) with check (true);
--
-- With no TO clause, a policy applies to PUBLIC — granting anon and
-- authenticated full read/write over criminal-history answers tied to
-- named individuals, despite the policy's name. Restricted to
-- service_role below, matching the remediation pattern already
-- established in 20260701_rls_remediation_anon_reachable_tables.sql and
-- 20260716000000_fix_shadow_log_insert_policies_service_role_only.sql.
-- Policy creation is also guarded so re-running this file is idempotent
-- (CREATE POLICY has no IF NOT EXISTS form).
--
-- Applied to production 2026-08-01 as migration
-- `character_question_confirmations`.

create table if not exists public.character_question_confirmations (
  id                   uuid primary key default gen_random_uuid(),
  deal_id              uuid not null references public.deals(id) on delete cascade,
  ownership_entity_id  uuid not null references public.ownership_entities(id) on delete cascade,
  field_key            text not null,
  answer               boolean not null,
  confirmed_at         timestamptz not null default now(),
  confirmed_by         text not null default 'borrower',
  ip_address           inet,
  user_agent           text,
  created_at           timestamptz not null default now()
);

create unique index if not exists uq_char_confirm_deal_owner_field
  on public.character_question_confirmations (deal_id, ownership_entity_id, field_key);

create index if not exists ix_char_confirm_deal
  on public.character_question_confirmations (deal_id);

alter table public.character_question_confirmations enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy p
    join pg_class c on c.oid = p.polrelid
    where c.relname = 'character_question_confirmations'
      and p.polname = 'service_role_all'
  ) then
    create policy "service_role_all"
      on public.character_question_confirmations
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

comment on table public.character_question_confirmations is
  'SPEC-SBA-FORM-COMPLETION-V1 §3.C — explicit borrower confirmation of '
  'character/criminal-history answers. A value in ownership_entities alone '
  '(from LLM extraction) is NOT sufficient; the completeness gate requires '
  'a matching row here. RLS: service_role only.';
