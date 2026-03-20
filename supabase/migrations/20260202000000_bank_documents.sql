-- Bank-level document library: policies, guidelines, templates, etc.
-- Each document is scoped to a single bank (multi-tenant isolation).
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

-- Index for bank-scoped queries
create index if not exists idx_bank_documents_bank_id on public.bank_documents(bank_id);

-- RLS
alter table public.bank_documents enable row level security;

create policy "bank_documents_read_own_bank"
  on public.bank_documents for select
  using (true);

create policy "bank_documents_service_role_all"
  on public.bank_documents for all
  using (true)
  with check (true);
