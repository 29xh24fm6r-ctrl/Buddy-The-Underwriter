-- Applied directly to production via MCP apply_migration; committed here for
-- the record (verified against live schema before writing any code against
-- it: bank_id/referral_source_org_id/updated_at columns, all four indexes,
-- and the updated_at trigger all confirmed present).

alter table public.brokerage_leads
  add column if not exists bank_id uuid references public.banks(id),
  add column if not exists referral_source_org_id uuid references public.crm_organizations(id),
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_brokerage_leads_bank_id on public.brokerage_leads(bank_id);
create index if not exists idx_brokerage_leads_status on public.brokerage_leads(bank_id, status);
create index if not exists idx_brokerage_leads_email on public.brokerage_leads(bank_id, email);
create index if not exists idx_brokerage_leads_referral_org on public.brokerage_leads(referral_source_org_id) where referral_source_org_id is not null;

create or replace function public.set_brokerage_leads_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_brokerage_leads_updated_at on public.brokerage_leads;
create trigger trg_brokerage_leads_updated_at
  before update on public.brokerage_leads
  for each row
  execute function public.set_brokerage_leads_updated_at();
