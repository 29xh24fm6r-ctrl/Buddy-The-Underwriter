-- Canonical Buddy signal ledger (append-only)
-- NOTE: Run in Supabase SQL editor or via your migration workflow.

begin;

create table if not exists public.buddy_signal_ledger (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  bank_id uuid not null,
  deal_id uuid null,
  type text not null,
  source text not null,
  payload jsonb null
);

create index if not exists buddy_signal_ledger_bank_created_idx
  on public.buddy_signal_ledger (bank_id, created_at desc);

create index if not exists buddy_signal_ledger_deal_created_idx
  on public.buddy_signal_ledger (deal_id, created_at desc);

-- RLS
alter table public.buddy_signal_ledger enable row level security;

-- Policy: same-bank read/write (service role bypasses; auth users restricted)
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='buddy_signal_ledger'
      and policyname='buddy_signal_ledger_same_bank_select'
  ) then
    create policy buddy_signal_ledger_same_bank_select
      on public.buddy_signal_ledger
      for select
      using (bank_id = public.get_current_bank_id());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename='buddy_signal_ledger'
      and policyname='buddy_signal_ledger_same_bank_insert'
  ) then
    create policy buddy_signal_ledger_same_bank_insert
      on public.buddy_signal_ledger
      for insert
      with check (bank_id = public.get_current_bank_id());
  end if;
end $$;

commit;
