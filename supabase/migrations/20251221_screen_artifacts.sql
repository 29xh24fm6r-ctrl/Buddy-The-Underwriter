-- Screen Artifacts for Shareable Link Export v1
begin;

create table if not exists public.screen_artifacts (
  id text primary key, -- cuid/nanoid for URL safety
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  
  prompt text not null,
  role text null, -- Banker|Borrower|Underwriter
  title text not null,
  layout_type text not null, -- dashboard|form|settings|landing
  content jsonb not null,
  
  status text not null default 'generated', -- generated|failed
  owner_id uuid null references auth.users(id) on delete set null,
  is_public boolean not null default true,
  view_count int not null default 0
);

create index if not exists idx_screen_artifacts_created on public.screen_artifacts(created_at desc);
create index if not exists idx_screen_artifacts_owner on public.screen_artifacts(owner_id);
create index if not exists idx_screen_artifacts_public on public.screen_artifacts(is_public) where is_public = true;

-- RLS: Public reads, owner writes
alter table public.screen_artifacts enable row level security;

-- Anyone can read public screens
create policy screen_artifacts_public_read
  on public.screen_artifacts
  for select
  using (is_public = true);

-- Authenticated users can read their own screens
create policy screen_artifacts_owner_read
  on public.screen_artifacts
  for select
  to authenticated
  using (owner_id = auth.uid());

-- Only owners can update their screens
create policy screen_artifacts_owner_update
  on public.screen_artifacts
  for update
  to authenticated
  using (owner_id = auth.uid());

-- Service role can insert (for anonymous generation)
-- Note: In production, use service role key or anon insert policy
grant insert on public.screen_artifacts to anon, authenticated;

commit;
