alter table public.decision_snapshots
add column if not exists committee_required boolean not null default false;
