-- Research Engine Hardening Migration
-- Adds:
-- 1. HTTP cache table for source responses
-- 2. Mission orchestration improvements (run_key, timeboxing)
-- 3. Research autonomy settings

-- ============================================================================
-- 1. HTTP Cache Table
-- ============================================================================

create table if not exists public.buddy_research_http_cache (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- Cache key
  url text not null,
  url_hash text not null, -- SHA256 of URL for fast lookup

  -- Response metadata
  etag text null,
  last_modified text null,
  content_type text null,

  -- Response data
  body_checksum text not null, -- SHA256 of response body
  body_size_bytes integer not null,

  -- Cache control
  cached_at timestamptz not null default now(),
  ttl_seconds integer not null default 900, -- 15 minutes default
  expires_at timestamptz generated always as (cached_at + (ttl_seconds || ' seconds')::interval) stored,

  -- Usage tracking
  hit_count integer not null default 0,
  last_hit_at timestamptz null
);

-- Indexes for fast lookup
create unique index if not exists buddy_research_http_cache_url_hash_idx
  on public.buddy_research_http_cache (url_hash);
create index if not exists buddy_research_http_cache_expires_at_idx
  on public.buddy_research_http_cache (expires_at);
create index if not exists buddy_research_http_cache_cached_at_idx
  on public.buddy_research_http_cache (cached_at desc);

-- Function to clean up expired cache entries
create or replace function public.cleanup_research_http_cache()
returns integer
language plpgsql
security definer
as $$
declare
  deleted_count integer;
begin
  delete from public.buddy_research_http_cache
  where expires_at < now();

  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

-- ============================================================================
-- 2. Research Missions Table Enhancements
-- ============================================================================

-- Add run_key for idempotency (if buddy_research_missions exists)
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'buddy_research_missions'
  ) then
    -- Add run_key column if not exists
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'buddy_research_missions'
        and column_name = 'run_key'
    ) then
      alter table public.buddy_research_missions
        add column run_key text null;

      -- Create unique index for idempotency
      create unique index if not exists buddy_research_missions_run_key_active_idx
        on public.buddy_research_missions (deal_id, run_key)
        where status in ('queued', 'running', 'complete');
    end if;

    -- Add timebox columns if not exist
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'buddy_research_missions'
        and column_name = 'max_sources'
    ) then
      alter table public.buddy_research_missions
        add column max_sources integer null,
        add column max_fetch_seconds integer null,
        add column max_extract_seconds integer null,
        add column timeboxed boolean not null default false;
    end if;

    -- Add force_rerun column if not exists
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'buddy_research_missions'
        and column_name = 'force_rerun'
    ) then
      alter table public.buddy_research_missions
        add column force_rerun boolean not null default false;
    end if;
  end if;
end $$;

-- ============================================================================
-- 3. Research Autonomy Settings
-- ============================================================================

create table if not exists public.buddy_research_autonomy_settings (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Scope (bank, deal, or global)
  bank_id uuid null,
  deal_id uuid null,

  -- Autonomy level: OFF, RECOMMEND, AUTO_RUN
  autonomy_level text not null default 'RECOMMEND'
    check (autonomy_level in ('OFF', 'RECOMMEND', 'AUTO_RUN')),

  -- Who set this
  set_by_user_id uuid null,

  -- Audit
  previous_level text null,
  reason text null
);

create unique index if not exists buddy_research_autonomy_settings_deal_idx
  on public.buddy_research_autonomy_settings (deal_id)
  where deal_id is not null;
create unique index if not exists buddy_research_autonomy_settings_bank_idx
  on public.buddy_research_autonomy_settings (bank_id)
  where bank_id is not null and deal_id is null;
create index if not exists buddy_research_autonomy_settings_updated_at_idx
  on public.buddy_research_autonomy_settings (updated_at desc);

-- Trigger for updated_at
create or replace function public.update_research_autonomy_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists buddy_research_autonomy_settings_updated_at_trigger
  on public.buddy_research_autonomy_settings;
create trigger buddy_research_autonomy_settings_updated_at_trigger
  before update on public.buddy_research_autonomy_settings
  for each row execute function public.update_research_autonomy_updated_at();

-- ============================================================================
-- 4. Research Plan Overrides (for human-in-the-loop)
-- ============================================================================

create table if not exists public.buddy_research_plan_overrides (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  deal_id uuid not null,

  -- Plan identification
  plan_id text not null,

  -- Override type
  action text not null
    check (action in ('approve', 'reject', 'disable_mission', 'enable_mission', 'reorder', 'force_rerun')),

  -- Mission affected (for mission-level overrides)
  mission_type text null,

  -- Override data
  data jsonb not null default '{}'::jsonb,

  -- Who made the override
  user_id uuid not null,
  reason text null
);

create index if not exists buddy_research_plan_overrides_deal_idx
  on public.buddy_research_plan_overrides (deal_id);
create index if not exists buddy_research_plan_overrides_plan_idx
  on public.buddy_research_plan_overrides (plan_id);
create index if not exists buddy_research_plan_overrides_created_at_idx
  on public.buddy_research_plan_overrides (created_at desc);

-- ============================================================================
-- 5. Research Blocked Sources Log
-- ============================================================================

create table if not exists public.buddy_research_blocked_sources (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  -- What was blocked
  url text not null,
  domain text not null,
  reason text not null,

  -- Context
  mission_id uuid null,
  deal_id uuid null
);

create index if not exists buddy_research_blocked_sources_created_at_idx
  on public.buddy_research_blocked_sources (created_at desc);
create index if not exists buddy_research_blocked_sources_domain_idx
  on public.buddy_research_blocked_sources (domain);

-- ============================================================================
-- 6. Research Diagnostics View
-- ============================================================================

create or replace view public.buddy_research_diagnostics as
select
  deal_id,
  count(*) filter (where status = 'complete') as complete_missions,
  count(*) filter (where status = 'failed') as failed_missions,
  count(*) filter (where status = 'running') as running_missions,
  count(*) filter (where timeboxed = true) as timeboxed_missions,
  max(completed_at) as last_mission_completed,
  avg(extract(epoch from (completed_at - started_at))) as avg_mission_duration_seconds
from public.buddy_research_missions
group by deal_id;

-- ============================================================================
-- RLS Policies
-- ============================================================================

alter table public.buddy_research_http_cache enable row level security;
alter table public.buddy_research_autonomy_settings enable row level security;
alter table public.buddy_research_plan_overrides enable row level security;
alter table public.buddy_research_blocked_sources enable row level security;

-- HTTP cache is internal, only service role can access
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='buddy_research_http_cache' and policyname='research_cache_service_only'
  ) then
    create policy research_cache_service_only
    on public.buddy_research_http_cache
    for all
    to service_role
    using (true)
    with check (true);
  end if;
end $$;

-- Autonomy settings readable by authenticated users
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='buddy_research_autonomy_settings' and policyname='research_autonomy_read_authed'
  ) then
    create policy research_autonomy_read_authed
    on public.buddy_research_autonomy_settings
    for select
    to authenticated
    using (true);
  end if;
end $$;

-- Plan overrides readable by authenticated users
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='buddy_research_plan_overrides' and policyname='research_overrides_read_authed'
  ) then
    create policy research_overrides_read_authed
    on public.buddy_research_plan_overrides
    for select
    to authenticated
    using (true);
  end if;
end $$;

-- Blocked sources readable by authenticated users
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='buddy_research_blocked_sources' and policyname='research_blocked_read_authed'
  ) then
    create policy research_blocked_read_authed
    on public.buddy_research_blocked_sources
    for select
    to authenticated
    using (true);
  end if;
end $$;

-- Grant permissions
grant select, insert, update, delete on public.buddy_research_http_cache to service_role;
grant select on public.buddy_research_autonomy_settings to authenticated;
grant select, insert on public.buddy_research_plan_overrides to authenticated;
grant select on public.buddy_research_blocked_sources to authenticated;
grant select on public.buddy_research_diagnostics to authenticated;
