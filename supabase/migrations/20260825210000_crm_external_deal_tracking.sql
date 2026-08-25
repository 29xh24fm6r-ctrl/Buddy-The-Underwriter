-- Lightweight off-platform deal records for brokerage CRM tracking.
-- These records share the canonical deals ledger but do not represent a
-- borrower intake or a full-underwrite request.

alter table public.deals
  add column crm_tracking_only boolean not null default false,
  add column external_deal_source text,
  add column external_reference text;

comment on column public.deals.crm_tracking_only is
  'True when the deal was manually entered only for brokerage CRM distribution/outcome tracking.';
comment on column public.deals.external_deal_source is
  'How an off-platform CRM deal reached the brokerage (referral, banker handoff, marketplace, etc.).';
comment on column public.deals.external_reference is
  'Optional source-system or broker reference for an off-platform CRM deal.';

create index idx_deals_crm_tracking
  on public.deals (bank_id, created_at desc)
  where crm_tracking_only = true;
