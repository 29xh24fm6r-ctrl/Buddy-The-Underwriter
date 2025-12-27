-- Tenant email routing configuration (bank_id is the tenant identifier)

create table if not exists public.tenant_email_routing (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  contact_to_email text not null,
  outbound_from_email text not null,
  reply_to_mode text not null default 'submitter',
  configured_reply_to_email text null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists tenant_email_routing_bank_unique
  on public.tenant_email_routing (bank_id);

alter table public.tenant_email_routing
  add constraint tenant_email_routing_reply_to_mode_chk
  check (reply_to_mode in ('submitter','configured'));

-- Reuse existing set_updated_at trigger function (already exists in schema)
drop trigger if exists trg_tenant_email_routing_updated_at on public.tenant_email_routing;
create trigger trg_tenant_email_routing_updated_at
before update on public.tenant_email_routing
for each row execute function public.set_updated_at();

-- RLS: deny-all (server-side tenant checks via supabaseAdmin)
alter table public.tenant_email_routing enable row level security;

comment on table public.tenant_email_routing is 
  'Per-tenant email routing config for contact form & outbound. Uses bank_id as tenant.';
