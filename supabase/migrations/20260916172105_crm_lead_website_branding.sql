alter table public.brokerage_leads
  add column if not exists website_url text;

comment on column public.brokerage_leads.website_url is
  'Canonical public business website captured during lead intake and carried into the borrower record at conversion.';
