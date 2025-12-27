-- Bank-scoped email routing configuration (bank_id is the tenant key in this app)

create table if not exists public.bank_email_routing (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  contact_to_email text not null,
  outbound_from_email text not null,
  reply_to_mode text not null default 'submitter', -- 'submitter' | 'configured'
  configured_reply_to_email text null,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists bank_email_routing_bank_unique
  on public.bank_email_routing (bank_id);

alter table public.bank_email_routing
  add constraint bank_email_routing_reply_to_mode_chk
  check (reply_to_mode in ('submitter','configured'));

-- RLS: deny-all (server-side tenant checks via supabaseAdmin)
alter table public.bank_email_routing enable row level security;

-- Reuse existing set_updated_at trigger function
drop trigger if exists trg_bank_email_routing_updated_at on public.bank_email_routing;
create trigger trg_bank_email_routing_updated_at
before update on public.bank_email_routing
for each row execute function public.set_updated_at();

-- Best-effort data copy from older table if it exists (non-fatal if not)
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'tenant_email_routing') then
    insert into public.bank_email_routing (bank_id, contact_to_email, outbound_from_email, reply_to_mode, configured_reply_to_email, is_enabled)
    select
      tenant_id as bank_id,
      contact_to_email,
      outbound_from_email,
      reply_to_mode,
      configured_reply_to_email,
      is_enabled
    from public.tenant_email_routing
    on conflict (bank_id) do nothing;
  end if;
end $$;

comment on table public.bank_email_routing is 
  'Per-bank email routing config for contact form & outbound. Uses bank_id as tenant key.';
