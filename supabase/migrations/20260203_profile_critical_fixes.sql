-- Critical profile fixes: avatar columns + bank_memberships role
-- Run this in Supabase Dashboard → SQL Editor if profile page shows schema errors

-- 1. Add avatar/display_name columns to profiles (idempotent)
alter table public.profiles
  add column if not exists display_name text,
  add column if not exists avatar_url text,
  add column if not exists avatar_updated_at timestamptz;

-- 2. Ensure bank_memberships has role column (idempotent)
alter table public.bank_memberships
  add column if not exists role text not null default 'member';

-- 3. Ensure profiles has bank context columns (idempotent)
alter table public.profiles
  add column if not exists bank_id uuid references public.banks(id),
  add column if not exists last_bank_id uuid references public.banks(id),
  add column if not exists bank_selected_at timestamptz;

-- 4. Create bank_documents table if not exists
create table if not exists public.bank_documents (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references public.banks(id),
  title text not null,
  description text,
  category text not null default 'general',
  storage_bucket text not null default 'bank-documents',
  storage_path text not null,
  original_filename text not null,
  mime_type text,
  size_bytes bigint,
  uploaded_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_bank_documents_bank_id on public.bank_documents(bank_id);

-- 5. RLS for bank_documents (skip if policy exists)
alter table public.bank_documents enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'bank_documents_service_role_all') then
    create policy "bank_documents_service_role_all"
      on public.bank_documents for all
      using (true)
      with check (true);
  end if;
end $$;
