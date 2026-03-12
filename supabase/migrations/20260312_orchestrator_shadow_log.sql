-- Phase 25: orchestrator_shadow_log — shadow comparison telemetry for AI provider migration
create table orchestrator_shadow_log (
  id            uuid primary key default gen_random_uuid(),
  deal_id       uuid references deals(id) on delete cascade,
  operation     text not null,              -- 'generateRisk' | 'generateMemo' | 'chatAboutDeal'
  primary_model text not null,              -- e.g. 'gpt-4o-2024-08-06'
  shadow_model  text not null,              -- e.g. 'gemini-2.5-pro-preview-03-25'
  primary_result  jsonb,
  shadow_result   jsonb,
  agree         boolean,                    -- key-field match (grade for risk, section_count for memo)
  primary_ms    integer,                    -- latency of primary call
  shadow_ms     integer,                    -- latency of shadow call
  error_primary text,
  error_shadow  text,
  created_at    timestamptz default now()
);

alter table orchestrator_shadow_log enable row level security;

create policy "bank_isolation" on orchestrator_shadow_log
  using (
    deal_id in (
      select id from deals where bank_id = (
        select bank_id from profiles where id = auth.uid()
      )
    )
  );

create index orchestrator_shadow_log_deal_id_idx on orchestrator_shadow_log(deal_id);
create index orchestrator_shadow_log_operation_idx on orchestrator_shadow_log(operation);
create index orchestrator_shadow_log_agree_idx on orchestrator_shadow_log(agree);
