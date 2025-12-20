-- Bulletproof banks table + deals.bank_id + seed OGB

create table if not exists public.banks (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='deals'
  ) then
    if not exists (
      select 1 from information_schema.columns
      where table_schema='public' and table_name='deals' and column_name='bank_id'
    ) then
      alter table public.deals add column bank_id uuid null;
    end if;

    if not exists (select 1 from pg_constraint where conname='deals_bank_id_fkey') then
      alter table public.deals
        add constraint deals_bank_id_fkey
        foreign key (bank_id) references public.banks(id)
        on delete set null;
    end if;

    create index if not exists idx_deals_bank_id on public.deals(bank_id);
  end if;
end $$;

insert into public.banks (code, name)
values ('OGB', 'Old Glory Bank')
on conflict (code) do nothing;
