-- User usage limits and plan tracking
begin;

-- Add usage tracking columns to auth.users via metadata
-- Note: In Supabase, we store this in user_metadata or a separate table
-- Using separate table for cleaner queries and RLS

create table if not exists public.user_usage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free', -- 'free' | 'pro'
  free_continues_used int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_user_usage_plan on public.user_usage(plan);
create index if not exists idx_user_usage_continues on public.user_usage(free_continues_used);

-- RLS
alter table public.user_usage enable row level security;

-- Users can read their own usage
create policy user_usage_read_own
  on public.user_usage
  for select
  to authenticated
  using (user_id = auth.uid());

-- Users can update their own usage (for self-service upgrade)
create policy user_usage_update_own
  on public.user_usage
  for update
  to authenticated
  using (user_id = auth.uid());

-- Service role can insert (when user first continues)
grant insert on public.user_usage to authenticated;

commit;
