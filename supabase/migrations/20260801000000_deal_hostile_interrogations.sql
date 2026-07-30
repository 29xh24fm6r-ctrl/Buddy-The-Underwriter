-- SPEC-M6 ANTICIPATED-INTERROGATION-1
--
-- One row per hostile-credit-committee question the verifier role generates
-- for a deal (src/lib/ai/committeeInterrogation.ts). Deliberately a separate
-- table rather than a field spliced into buddy_sealed_packages.sealed_snapshot
-- jsonb: keeps "canonical sealed content is immutable" literally true (no
-- read-modify-write on that blob) and makes the appendix independently
-- queryable/regenerable without touching the seal record at all.
--
-- Bank-internal only (per the approved design decision) — this table is not
-- read by redactForMarketplace/buildKFS and nothing here reaches
-- marketplace_listings.kfs. Visible to bank staff via deal_conditions
-- (banker tasks, generated from unanswered rows) and, for borrower-resolvable
-- gaps, via the existing borrower fix-cards surface (buildFixCards.ts).
begin;

create table if not exists public.deal_hostile_interrogations (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  code text not null,
  question text not null,
  domain text not null,
  severity text not null default 'warning' check (severity in ('info', 'warning', 'critical')),
  already_answered boolean not null default false,
  rationale text not null,
  resolving_action text not null,
  borrower_resolvable boolean not null default false,
  model text null,
  generated_at timestamptz not null default now(),
  unique (deal_id, code)
);

create index if not exists deal_hostile_interrogations_deal_id_idx
  on public.deal_hostile_interrogations (deal_id);

alter table public.deal_hostile_interrogations enable row level security;

-- Same bank-membership pattern as deal_conditions (bank staff only — this
-- is a banker/underwriting-prep artifact, not borrower- or lender-facing).
-- drop-then-create so a partial-apply retry doesn't fail with "policy
-- already exists" (CREATE POLICY has no IF NOT EXISTS form).
drop policy if exists deal_hostile_interrogations_bank_access on public.deal_hostile_interrogations;
create policy deal_hostile_interrogations_bank_access
  on public.deal_hostile_interrogations
  for all
  using (
    exists (
      select 1 from public.bank_memberships bm
      where bm.bank_id = deal_hostile_interrogations.bank_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner', 'admin', 'member')
    )
  )
  with check (
    exists (
      select 1 from public.bank_memberships bm
      where bm.bank_id = deal_hostile_interrogations.bank_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner', 'admin', 'member')
    )
  );

commit;
