-- §3.C — Character question explicit confirmation tracking.
--
-- An LLM must not infer a criminal-history answer from conversational text.
-- Extraction may pre-fill the ownership_entities column; only an explicit
-- borrower action (clicking "I confirm this answer") creates a row here.
-- The completeness gate (§7) requires BOTH the column value AND a
-- confirmation row before marking a character question as answered.

create table if not exists character_question_confirmations (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references deals(id) on delete cascade,
  ownership_entity_id uuid not null references ownership_entities(id) on delete cascade,
  field_key   text not null,
  answer      boolean not null,
  confirmed_at timestamptz not null default now(),
  confirmed_by text not null default 'borrower',
  ip_address  inet,
  user_agent  text,
  created_at  timestamptz not null default now()
);

create unique index if not exists uq_char_confirm_deal_owner_field
  on character_question_confirmations (deal_id, ownership_entity_id, field_key);

create index if not exists ix_char_confirm_deal
  on character_question_confirmations (deal_id);

alter table character_question_confirmations enable row level security;

create policy "service_role_all" on character_question_confirmations
  for all using (true) with check (true);

comment on table character_question_confirmations is
  '§3.C — tracks explicit borrower confirmation of character/criminal-history answers. '
  'A value in ownership_entities alone (from LLM extraction) is NOT sufficient; '
  'the completeness gate requires a matching row here.';
