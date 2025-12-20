begin;

-- 1) Deal intake / loan-type settings (avoid assuming your deals table has these columns)
create table if not exists public.deal_intake (
  deal_id uuid primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  loan_type text not null default 'CRE' check (loan_type in ('CRE','LOC','TERM','SBA_7A','SBA_504')),
  sba_program text null check (sba_program in ('7A','504') or sba_program is null),

  borrower_name text null,
  borrower_email text null,
  borrower_phone text null
);

create index if not exists deal_intake_loan_type_idx on public.deal_intake(loan_type);

-- updated_at trigger helper
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_deal_intake_updated_at on public.deal_intake;
create trigger trg_deal_intake_updated_at
before update on public.deal_intake
for each row execute function public.set_updated_at();

-- 2) Reminder subscriptions: add "missing_only" switch (explicitly enforce keys-only reminders)
alter table public.deal_reminder_subscriptions
  add column if not exists missing_only boolean not null default true;

commit;
