begin;

-- 1) Add bank_id (tenant isolation) if missing
alter table public.deal_intake
  add column if not exists bank_id uuid;

-- 2) Backfill bank_id from deals (safe no-op if already filled)
update public.deal_intake di
set bank_id = d.bank_id
from public.deals d
where d.id = di.deal_id
  and di.bank_id is null;

-- 3) Enforce NOT NULL (guard: only if no nulls remain)
do $$
begin
  if exists (select 1 from public.deal_intake where bank_id is null) then
    raise exception 'deal_intake.bank_id still has NULLs; cannot set NOT NULL yet';
  end if;

  alter table public.deal_intake
    alter column bank_id set not null;
end $$;

-- 4) Add FK to banks (idempotent)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'deal_intake_bank_id_fkey'
  ) then
    alter table public.deal_intake
      add constraint deal_intake_bank_id_fkey
      foreign key (bank_id) references public.banks(id) on delete cascade;
  end if;
end $$;

create index if not exists deal_intake_bank_id_idx on public.deal_intake(bank_id);

-- 5) RLS
alter table public.deal_intake enable row level security;

drop policy if exists deal_intake_select on public.deal_intake;
drop policy if exists deal_intake_insert on public.deal_intake;
drop policy if exists deal_intake_update on public.deal_intake;

create policy deal_intake_select
on public.deal_intake
for select
using (bank_id = current_setting('app.current_bank_id', true)::uuid);

create policy deal_intake_insert
on public.deal_intake
for insert
with check (bank_id = current_setting('app.current_bank_id', true)::uuid);

create policy deal_intake_update
on public.deal_intake
for update
using (bank_id = current_setting('app.current_bank_id', true)::uuid)
with check (bank_id = current_setting('app.current_bank_id', true)::uuid);

commit;
