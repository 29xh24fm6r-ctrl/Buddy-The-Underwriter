-- Phase 56: Underwriting Launch Control

-- Immutable launch snapshots
create table if not exists public.underwriting_launch_snapshots (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  launch_sequence int not null,
  launched_by uuid not null,
  launched_at timestamptz not null default now(),
  lifecycle_stage_at_launch text not null,
  borrower_snapshot_json jsonb not null,
  deal_snapshot_json jsonb not null,
  loan_request_snapshot_json jsonb not null,
  requirement_snapshot_json jsonb not null,
  document_snapshot_json jsonb not null,
  readiness_snapshot_json jsonb not null,
  blocker_snapshot_json jsonb not null,
  guidance_snapshot_json jsonb null,
  analyst_handoff_note text null,
  certification_json jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.underwriting_launch_snapshots enable row level security;
create policy "bank_scoped_uw_snapshots" on public.underwriting_launch_snapshots
  using (deal_id in (select id from deals where bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1)));
create index if not exists idx_uw_snapshots_deal on public.underwriting_launch_snapshots (deal_id, launch_sequence desc);

-- Underwriting workspaces
create table if not exists public.underwriting_workspaces (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null unique references public.deals(id) on delete cascade,
  active_snapshot_id uuid not null references public.underwriting_launch_snapshots(id),
  status text not null default 'in_progress',
  launched_at timestamptz not null,
  launched_by uuid not null,
  assigned_analyst_id uuid null,
  spread_status text not null default 'not_started',
  memo_status text not null default 'not_started',
  risk_status text not null default 'not_started',
  refresh_required boolean not null default false,
  drift_detected_at timestamptz null,
  latest_drift_summary_json jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint uw_workspaces_status_ck check (
    status in ('not_started','in_progress','needs_refresh','completed')
  )
);

alter table public.underwriting_workspaces enable row level security;
create policy "bank_scoped_uw_workspaces" on public.underwriting_workspaces
  using (deal_id in (select id from deals where bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1)));

-- Drift events
create table if not exists public.underwriting_drift_events (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  workspace_id uuid not null references public.underwriting_workspaces(id) on delete cascade,
  snapshot_id uuid not null references public.underwriting_launch_snapshots(id),
  drift_type text not null,
  severity text not null,
  summary text not null,
  details_json jsonb not null,
  detected_at timestamptz not null default now(),
  resolved_at timestamptz null,
  resolution_type text null,

  constraint uw_drift_severity_ck check (severity in ('warning','material')),
  constraint uw_drift_resolution_ck check (resolution_type is null or resolution_type in ('ignored','refreshed','relaunched'))
);

alter table public.underwriting_drift_events enable row level security;
create policy "bank_scoped_uw_drift" on public.underwriting_drift_events
  using (deal_id in (select id from deals where bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1)));
create index if not exists idx_uw_drift_workspace on public.underwriting_drift_events (workspace_id, detected_at desc);

-- Launch certifications
create table if not exists public.underwriting_launch_certifications (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  snapshot_id uuid not null references public.underwriting_launch_snapshots(id),
  certified_by uuid not null,
  certified_at timestamptz not null default now(),
  certification_text text not null,
  eligibility_json jsonb not null,
  handoff_note text null,
  created_at timestamptz not null default now()
);

alter table public.underwriting_launch_certifications enable row level security;
create policy "bank_scoped_uw_certifications" on public.underwriting_launch_certifications
  using (deal_id in (select id from deals where bank_id = (select bank_id from bank_users where user_id = auth.uid() limit 1)));
create index if not exists idx_uw_certifications_deal on public.underwriting_launch_certifications (deal_id, certified_at desc);
