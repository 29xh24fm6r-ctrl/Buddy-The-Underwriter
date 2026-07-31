BEGIN;

-- SPEC-ASSUMPTION-CONFIRM-DEADEND-FIX-V1
--
-- buddy_sba_assumptions has never had any event/audit trail at all. Every
-- row in production (8/8, confirmed via live-data query) sits at
-- status='draft' forever, and diagnosing why required a source read of
-- AssumptionInterview.tsx rather than a data query. This table gives the
-- next stuck deal a queryable trail: research-projections failures,
-- confirm transitions, and the downstream trident-bundle trigger outcome
-- all land here.
--
-- Deliberately a lightweight, generic {event_type, detail} shape (mirrors
-- brokerage_conversion_events' event_type-as-text convention elsewhere in
-- this repo) rather than a bespoke column per event type — this is a
-- diagnostic trail, not a metric requiring typed aggregation.
create table if not exists public.buddy_sba_assumptions_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists buddy_sba_assumptions_events_deal_id_idx
  on public.buddy_sba_assumptions_events (deal_id);

alter table public.buddy_sba_assumptions_events enable row level security;

-- Same bank-membership pattern as deal_hostile_interrogations — bank-staff
-- read access for diagnosis; all writes in this spec go through
-- supabaseAdmin() (service role, bypasses RLS) from server routes.
create policy buddy_sba_assumptions_events_bank_access
  on public.buddy_sba_assumptions_events
  for all
  using (
    exists (
      select 1 from public.bank_memberships bm
      where bm.bank_id = buddy_sba_assumptions_events.bank_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner', 'admin', 'member')
    )
  )
  with check (
    exists (
      select 1 from public.bank_memberships bm
      where bm.bank_id = buddy_sba_assumptions_events.bank_id
        and bm.user_id = auth.uid()
        and bm.role in ('owner', 'admin', 'member')
    )
  );

COMMIT;
