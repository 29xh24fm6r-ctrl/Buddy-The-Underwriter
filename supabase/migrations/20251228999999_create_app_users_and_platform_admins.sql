-- Create app_users table for Clerk-based authentication
-- This replaces Supabase auth.users since we're using Clerk as the identity provider

create extension if not exists pgcrypto;

-- App users table - maps Clerk user IDs to Buddy user UUIDs
create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text unique not null,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Platform admins table - super admins who can access /admin routes
create table if not exists public.platform_admins (
  user_id uuid primary key references public.app_users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Indexes for performance
create index if not exists idx_app_users_clerk_id on public.app_users(clerk_user_id);
create index if not exists idx_app_users_email on public.app_users(email);

-- RLS policies (deny by default, access via service role)
alter table public.app_users enable row level security;
alter table public.platform_admins enable row level security;

-- No RLS policies - all access via service role in token exchange
-- This follows the "Fort Knox" pattern documented in TENANT_SYSTEM_COMPLETE.md

-- Comments for documentation
comment on table public.app_users is 'Maps Clerk user IDs to Buddy UUIDs for RLS and authorization';
comment on table public.platform_admins is 'Super admins who can access /api/admin routes and platform-level features';
comment on column public.app_users.clerk_user_id is 'Clerk user ID from auth().userId';
comment on column public.app_users.id is 'Used as sub claim in Supabase JWT for RLS';
