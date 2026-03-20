-- 20251219_step15_checklist.sql

begin;

-- A deterministic checklist of required items per deal.
-- You can drive this from loan type/SBA later; for now it's explicit rows.
create table if not exists public.deal_checklist_items (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null,
  created_at timestamptz not null default now(),

  -- The only thing reminders reference
  checklist_key text not null,

  -- UI labels
  title text not null,
  description text null,

  -- State
  required boolean not null default true,
  status text not null default 'missing' check (status in ('missing','received','waived')),
  received_at timestamptz null,

  -- If received via upload
  received_file_id uuid null references public.deal_files(id) on delete set null,

  unique(deal_id, checklist_key)
);

create index if not exists deal_checklist_items_deal_id_idx on public.deal_checklist_items(deal_id);
create index if not exists deal_checklist_items_status_idx on public.deal_checklist_items(status);

commit;
