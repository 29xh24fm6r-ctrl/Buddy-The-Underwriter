begin;

-- Restore the durable schema contract required by the production nightly
-- portfolio aggregator. One row is retained per bank and UTC calendar date;
-- repeated nightly invocations update that same evidence row.
create table if not exists public.portfolio_risk_snapshots (
  bank_id uuid not null references public.banks(id) on delete cascade,
  as_of_date date not null,
  total_exposure numeric not null check (total_exposure >= 0),
  risk_weighted_exposure numeric not null check (risk_weighted_exposure >= 0),
  total_decisions integer not null check (total_decisions >= 0),
  decisions_with_exceptions integer not null
    check (
      decisions_with_exceptions >= 0
      and decisions_with_exceptions <= total_decisions
    ),
  exception_rate numeric not null check (exception_rate between 0 and 1),
  committee_required_count integer not null
    check (
      committee_required_count >= 0
      and committee_required_count <= total_decisions
    ),
  committee_override_rate numeric not null
    check (committee_override_rate between 0 and 1),
  concentration_json jsonb not null default '{}'::jsonb
    check (jsonb_typeof(concentration_json) = 'object'),
  created_at timestamptz not null default now(),
  primary key (bank_id, as_of_date)
);

comment on table public.portfolio_risk_snapshots is
  'Nightly bank-scoped portfolio risk evidence. One canonical snapshot per bank and UTC calendar date.';

comment on column public.portfolio_risk_snapshots.concentration_json is
  'Deterministic loan-size and decision-type concentration counts derived from final decision snapshots.';

create index if not exists portfolio_risk_snapshots_as_of_date_idx
  on public.portfolio_risk_snapshots (as_of_date desc);

alter table public.portfolio_risk_snapshots enable row level security;

drop policy if exists service_role_all
  on public.portfolio_risk_snapshots;
create policy service_role_all
  on public.portfolio_risk_snapshots
  for all
  to service_role
  using (true)
  with check (true);

revoke all on table public.portfolio_risk_snapshots
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.portfolio_risk_snapshots
  to service_role;

notify pgrst, 'reload schema';

commit;
