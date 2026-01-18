-- buddy_shadow_brain_results: async LLM results cache (never on voice critical path)

create table if not exists public.buddy_shadow_brain_results (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  bank_id uuid null,
  deal_id uuid null,

  -- stable cache key per request shape
  request_key text not null unique,

  status text not null default 'pending', -- pending|ready|error
  model text null,
  latency_ms integer null,

  -- structured JSON only (no prose required)
  result_json jsonb null,
  error_text text null
);

create index if not exists buddy_shadow_brain_results_deal_id_idx
  on public.buddy_shadow_brain_results(deal_id);

create index if not exists buddy_shadow_brain_results_status_idx
  on public.buddy_shadow_brain_results(status);

-- updated_at trigger (simple)
do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'buddy_shadow_brain_results_set_updated_at'
  ) then
    create trigger buddy_shadow_brain_results_set_updated_at
    before update on public.buddy_shadow_brain_results
    for each row
    execute function public.set_updated_at();
  end if;
exception when undefined_function then
  -- If set_updated_at() doesn't exist in your schema, skip trigger creation.
  null;
end $$;

-- RLS: admin-only via service role (routes use supabaseAdmin)
alter table public.buddy_shadow_brain_results enable row level security;
