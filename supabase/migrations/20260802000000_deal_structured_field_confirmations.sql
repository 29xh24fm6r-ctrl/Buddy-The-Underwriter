-- SPEC-M7 ZERO-REPEAT-PREFILL-1
--
-- Holds ONLY the LLM-touched residue fields the "structurer" gateway role
-- resolves — not a general fact store. Every BORROWER_FIELD_REGISTRY field
-- already has a deterministic sourceTable/sourceColumn (SPEC-M5) and is
-- read live from canonical state; this table exists solely for the one
-- category of value that genuinely needs a judgment call before it's safe
-- to use (today: classifying a loan's use-of-proceeds description into SBA
-- Form 1919's fixed purpose-category taxonomy, form1919/inputBuilder.ts's
-- long-flagged residue case).
--
-- Confirmed-gated by design: a row here is inert until a human (borrower
-- or banker) sets confirmed = true — form1919/inputBuilder.ts only reads a
-- CONFIRMED row to override its existing "everything routes to the Other
-- bucket" fallback. An unconfirmed or missing row changes nothing about
-- what a real, downloadable/signable form renders.
begin;

create table if not exists public.deal_structured_field_confirmations (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  form_code text not null,
  field_key text not null,
  value jsonb not null,
  rationale text not null,
  confidence text not null default 'medium' check (confidence in ('low', 'medium', 'high')),
  confirmed boolean not null default false,
  confirmed_at timestamptz null,
  model text null,
  generated_at timestamptz not null default now(),
  unique (deal_id, form_code, field_key)
);

create index if not exists deal_structured_field_confirmations_deal_id_idx
  on public.deal_structured_field_confirmations (deal_id);

alter table public.deal_structured_field_confirmations enable row level security;

-- Bank-staff access, same shape as deal_conditions/deal_hostile_interrogations.
-- drop-then-create so a partial-apply retry doesn't fail with "policy
-- already exists" (CREATE POLICY has no IF NOT EXISTS form).
drop policy if exists deal_structured_field_confirmations_bank_access on public.deal_structured_field_confirmations;
create policy deal_structured_field_confirmations_bank_access
  on public.deal_structured_field_confirmations
  for all
  using (
    exists (
      select 1 from public.bank_memberships bm
      where bm.bank_id = deal_structured_field_confirmations.bank_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner', 'admin', 'member')
    )
  )
  with check (
    exists (
      select 1 from public.bank_memberships bm
      where bm.bank_id = deal_structured_field_confirmations.bank_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner', 'admin', 'member')
    )
  );

commit;
