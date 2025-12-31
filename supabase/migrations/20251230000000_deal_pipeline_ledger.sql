-- Deal Pipeline Ledger: Canonical async state tracking for uploads → OCR → auto-seed
-- This is the SINGLE SOURCE OF TRUTH for pipeline state

create table if not exists public.deal_pipeline_ledger (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete cascade,
  bank_id uuid not null references public.banks(id) on delete cascade,

  -- Pipeline stages: upload | ocr_queued | ocr_running | ocr_complete | auto_seeded | failed
  stage text not null check (stage in ('upload', 'ocr_queued', 'ocr_running', 'ocr_complete', 'auto_seeded', 'failed')),
  
  -- Status: ok | pending | error
  status text not null check (status in ('ok', 'pending', 'error')),

  -- Flexible payload for stage-specific data
  payload jsonb default '{}'::jsonb,
  
  -- Error details when status = 'error'
  error text,

  created_at timestamptz not null default now()
);

-- Indexes for efficient querying
create index if not exists idx_pipeline_ledger_deal_id on public.deal_pipeline_ledger(deal_id);
create index if not exists idx_pipeline_ledger_deal_stage on public.deal_pipeline_ledger(deal_id, stage, created_at desc);
create index if not exists idx_pipeline_ledger_stage_status on public.deal_pipeline_ledger(stage, status, created_at desc);

-- RLS: deny all (use supabaseAdmin)
alter table public.deal_pipeline_ledger enable row level security;

-- Grant access to service role
grant select, insert, update, delete on public.deal_pipeline_ledger to service_role;

-- Helper function to get latest stage for a deal
create or replace function public.get_deal_pipeline_latest_stage(p_deal_id uuid)
returns table(
  stage text,
  status text,
  payload jsonb,
  error text,
  created_at timestamptz
)
language sql
security definer
as $$
  select stage, status, payload, error, created_at
  from public.deal_pipeline_ledger
  where deal_id = p_deal_id
  order by created_at desc
  limit 1;
$$;

-- Helper function to get stage history
create or replace function public.get_deal_pipeline_history(p_deal_id uuid, p_stage text default null)
returns table(
  id uuid,
  stage text,
  status text,
  payload jsonb,
  error text,
  created_at timestamptz
)
language sql
security definer
as $$
  select id, stage, status, payload, error, created_at
  from public.deal_pipeline_ledger
  where deal_id = p_deal_id
    and (p_stage is null or stage = p_stage)
  order by created_at desc;
$$;

comment on table public.deal_pipeline_ledger is 'Canonical ledger for async pipeline state (uploads → OCR → auto-seed). Never trust UI state—always query this.';
comment on column public.deal_pipeline_ledger.stage is 'upload | ocr_queued | ocr_running | ocr_complete | auto_seeded | failed';
comment on column public.deal_pipeline_ledger.status is 'ok | pending | error';
comment on column public.deal_pipeline_ledger.payload is 'Stage-specific metadata (e.g., file path, OCR confidence, matched items)';
