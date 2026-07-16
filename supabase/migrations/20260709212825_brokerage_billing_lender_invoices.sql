-- Reconstructed from live schema (supabase_migrations.schema_migrations) --
-- applied directly to the production project and never committed to the
-- repo. Captured verbatim for governance/reproducibility (see CRM audit,
-- 2026-07-16).

-- Brokerage billing core — Lago-inspired, radically simplified. Lago's real
-- invoice model handles progressive billing, prepaid wallets, multi-currency
-- proration, and tax-provider sync — none of which a referral-fee-on-funded-
-- loan business needs. What's kept, because it's genuinely load-bearing:
--   - invoice status as an explicit, guarded state machine
--     (draft -> finalized -> paid / void), separate from payment tracking
--   - sequential, human-readable invoice numbers, generated under an
--     advisory lock so two concurrent finalizations can never collide
--   - payments as their own table, not a column on the invoice — supports
--     partial payments and multiple attempts cleanly (Lago's pattern)
--
-- Money stays `numeric`, consistent with the rest of this schema (deals.loan_amount,
-- lender_marketplace_agreements.referral_fee_bps, etc.) — Postgres numeric is
-- exact fixed-point, so there's no precision reason to switch to integer cents
-- here, and doing so would just be an inconsistent convention against everything
-- else in the app.

create table lender_invoices (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null references banks(id) on delete cascade, -- brokerage tenant
  lender_bank_id uuid not null references banks(id) on delete restrict, -- who owes the fee
  invoice_number text, -- null while draft; assigned on finalize
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
  finalized_at timestamp with time zone,
  voided_at timestamp with time zone,
  created_by_clerk_user_id text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now(),
  constraint lender_invoices_number_required_when_not_draft check (
    status = 'draft' or invoice_number is not null
  )
);

create unique index idx_lender_invoices_number_per_bank
  on lender_invoices(bank_id, invoice_number)
  where invoice_number is not null;
create index idx_lender_invoices_bank_id on lender_invoices(bank_id);
create index idx_lender_invoices_lender_bank_id on lender_invoices(lender_bank_id);
create index idx_lender_invoices_status on lender_invoices(status);

create table lender_invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references lender_invoices(id) on delete cascade,
  deal_id uuid references deals(id) on delete set null,
  description text not null,
  amount numeric not null,
  created_at timestamp with time zone not null default now()
);

create index idx_lender_invoice_line_items_invoice_id on lender_invoice_line_items(invoice_id);
create index idx_lender_invoice_line_items_deal_id on lender_invoice_line_items(deal_id) where deal_id is not null;

create table lender_invoice_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references lender_invoices(id) on delete cascade,
  amount numeric not null,
  paid_at date not null default current_date,
  method text,
  reference text,
  recorded_by_clerk_user_id text,
  created_at timestamp with time zone not null default now()
);

create index idx_lender_invoice_payments_invoice_id on lender_invoice_payments(invoice_id);

-- Sequential invoice numbering, generated under an advisory lock scoped to
-- the brokerage tenant — mirrors Lago's generate_billing_entity_sequential_id
-- pattern (loop + advisory lock) so concurrent finalizations never collide.
-- Format: INV-{bank code prefix}-{YYYYMM}-{4-digit sequence within month}.
create or replace function next_lender_invoice_number(p_bank_id uuid)
returns text
language plpgsql
as $$
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
$$;
