-- 20260113000000_ai_doc_mapping.sql
-- Purpose:
-- 1) Persist AI-derived document classification + extracted metadata
-- 2) Record mapping evidence between uploads and checklist items
-- 3) Support adaptive checklist satisfaction (without relying on filenames)

begin;

-- A) Add AI classification fields onto deal_documents (canonical record of uploaded docs)
alter table if exists public.deal_documents
  add column if not exists ai_doc_type text,
  add column if not exists ai_issuer text,
  add column if not exists ai_form_numbers text[],
  add column if not exists ai_tax_year int,
  add column if not exists ai_period_start date,
  add column if not exists ai_period_end date,
  add column if not exists ai_borrower_name text,
  add column if not exists ai_business_name text,
  add column if not exists ai_confidence numeric,
  add column if not exists ai_model text,
  add column if not exists ai_reason text,
  add column if not exists ai_extracted_json jsonb;

-- B) Evidence table: one upload can map to many checklist items, each with confidence + rationale
create table if not exists public.deal_doc_mappings (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  document_id uuid not null references public.deal_documents(id) on delete cascade,
  checklist_key text not null,
  doc_year int null,
  confidence numeric not null default 0,
  status text not null default 'suggested', -- suggested | accepted | rejected | auto_accepted
  reason text null,
  features jsonb null,
  created_at timestamptz not null default now()
);

create index if not exists deal_doc_mappings_deal_id_idx
  on public.deal_doc_mappings(deal_id);

create index if not exists deal_doc_mappings_doc_id_idx
  on public.deal_doc_mappings(document_id);

create index if not exists deal_doc_mappings_checklist_key_idx
  on public.deal_doc_mappings(deal_id, checklist_key, doc_year);

-- C) RLS (bank-scoped)
alter table public.deal_doc_mappings enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='deal_doc_mappings'
      and policyname='bank_read_deal_doc_mappings'
  ) then
    create policy bank_read_deal_doc_mappings
      on public.deal_doc_mappings
      for select
      using (
        exists (
          select 1 from public.deals d
          where d.id = deal_doc_mappings.deal_id
            and d.bank_id = public.get_current_bank_id()
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='deal_doc_mappings'
      and policyname='bank_write_deal_doc_mappings'
  ) then
    create policy bank_write_deal_doc_mappings
      on public.deal_doc_mappings
      for insert
      with check (
        exists (
          select 1 from public.deals d
          where d.id = deal_doc_mappings.deal_id
            and d.bank_id = public.get_current_bank_id()
        )
      );
  end if;
end $$;

commit;
