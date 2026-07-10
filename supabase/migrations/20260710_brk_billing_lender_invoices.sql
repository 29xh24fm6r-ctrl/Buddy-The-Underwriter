-- Brokerage billing: lender_invoices table + next_lender_invoice_number() RPC.
--
-- Backfills tracked migration history for objects that were already live in
-- production (applied out-of-band) but never had a corresponding migration
-- file committed to the repo — caught by the SPEC-PORTAL-1 §4a rpc-existence
-- guard, which requires every `.rpc()` call site to name a function defined
-- by a CREATE FUNCTION in supabase/migrations.
--
-- CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE FUNCTION make this a no-op
-- against the current production database (both objects already exist there
-- with this exact shape) while making fresh environments (new Supabase
-- branches, local dev) match production.

create table if not exists lender_invoices (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id) on delete cascade,
  lender_bank_id uuid not null references banks(id) on delete restrict,
  invoice_number text,
  status text not null default 'draft'
    check (status in ('draft', 'finalized', 'paid', 'void')),
  payment_status text not null default 'pending'
    check (payment_status in ('pending', 'partially_paid', 'paid')),
  currency text not null default 'USD',
  amount numeric not null default 0,
  amount_paid numeric not null default 0,
  memo text,
  issued_at date,
  due_at date,
  finalized_at timestamptz,
  voided_at timestamptz,
  created_by_clerk_user_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint lender_invoices_number_required_when_not_draft
    check (status = 'draft' or invoice_number is not null)
);

create index if not exists idx_lender_invoices_bank
  on lender_invoices (bank_id);

create index if not exists idx_lender_invoices_lender_bank
  on lender_invoices (lender_bank_id);

comment on table lender_invoices is
  'Brokerage billing: invoices issued to lender banks, draft -> finalized -> paid/void.';

-- ── next_lender_invoice_number() ──────────────────────────────────────────
--
-- Assigns a sequential invoice number on finalize. Takes a per-tenant
-- Postgres advisory transaction lock so two concurrent finalizations for the
-- same bank can never collide on the same number (Lago's
-- generate_billing_entity_sequential_id pattern).

create or replace function public.next_lender_invoice_number(p_bank_id uuid)
 returns text
 language plpgsql
as $function$
declare
  v_lock_key bigint;
  v_prefix text;
  v_month text;
  v_seq int;
  v_number text;
begin
  v_lock_key := ('x' || substr(md5(p_bank_id::text), 1, 15))::bit(60)::bigint;
  perform pg_advisory_xact_lock(v_lock_key);

  select coalesce(code, 'BRK') into v_prefix from banks where id = p_bank_id;
  v_month := to_char(now(), 'YYYYMM');

  select count(*) + 1 into v_seq
  from lender_invoices
  where bank_id = p_bank_id
    and invoice_number like ('INV-' || v_prefix || '-' || v_month || '-%');

  v_number := 'INV-' || v_prefix || '-' || v_month || '-' || lpad(v_seq::text, 4, '0');
  return v_number;
end;
$function$;
