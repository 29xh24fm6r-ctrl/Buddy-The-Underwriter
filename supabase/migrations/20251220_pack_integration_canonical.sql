begin;

-- ============================================================
-- Pack Integration Canonical Tables & Views
-- ============================================================
-- Completes the pack intelligence system with:
-- 1. Pack Applications (banker actions)
-- 2. Confidence Summary (deal-specific)
-- 3. Progress & Risk tracking (borrower-safe)
-- ============================================================

-- ------------------------------------------------------------
-- A) Pack Applications (banker-controlled pack assignment)
-- ------------------------------------------------------------
create table if not exists public.borrower_pack_applications (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  deal_id uuid not null references public.deals(id) on delete cascade,
  pack_id uuid not null references public.borrower_pack_templates(id) on delete cascade,
  
  applied_by text, -- user ID or "system"
  manually_applied boolean not null default false,
  auto_applied boolean not null default false,
  
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists borrower_pack_applications_deal_id_idx 
  on public.borrower_pack_applications(deal_id);
create index if not exists borrower_pack_applications_pack_id_idx 
  on public.borrower_pack_applications(pack_id);
create index if not exists borrower_pack_applications_bank_id_idx 
  on public.borrower_pack_applications(bank_id);

-- ------------------------------------------------------------
-- B) Pack Confidence Summary (per-deal recommendations)
-- ------------------------------------------------------------
create or replace view public.borrower_pack_confidence_summary as
select
  me.deal_id,
  me.bank_id,
  pt.id as pack_id,
  pt.name as pack_name,
  
  me.match_score,
  
  -- Learning signals
  count(distinct le.id) as learning_events,
  avg(coalesce((le.metadata->>'blockers')::int, 0)) as avg_blockers,
  avg(coalesce((le.metadata->>'days_to_complete')::int, 0)) as avg_days,
  
  -- Confidence level (auto, suggest, manual)
  case
    when count(distinct le.id) >= 10
     and avg(coalesce((le.metadata->>'blockers')::int, 0)) <= 1
     and avg(case when le.event_type = 'override' then 1.0 else 0.0 end) < 0.2
    then 'high'
    
    when count(distinct le.id) >= 5
    then 'medium'
    
    else 'low'
  end as confidence,
  
  -- Rank per deal (1 = best match)
  row_number() over (
    partition by me.deal_id
    order by
      me.match_score desc,
      avg(coalesce((le.metadata->>'blockers')::int, 0)) asc,
      count(distinct le.id) desc
  ) as rank

from public.borrower_pack_match_events me
join public.borrower_pack_templates pt on pt.id = me.pack_id
left join public.borrower_pack_learning_events le on le.match_event_id = me.id

group by me.deal_id, me.bank_id, pt.id, pt.name, me.match_score;

-- ------------------------------------------------------------
-- C) Progress and Risk View (borrower-safe)
-- ------------------------------------------------------------
create or replace view public.borrower_progress_and_risk as
select
  d.id as deal_id,
  d.bank_id,
  
  -- Progress metrics
  count(bdr.id) filter (where bdr.status = 'received') as completed_count,
  count(bdr.id) as total_count,
  
  case 
    when count(bdr.id) > 0 
    then round((count(bdr.id) filter (where bdr.status = 'received')::float / count(bdr.id)) * 100)
    else 0 
  end as completion_percentage,
  
  -- Risk signals
  count(bdr.id) filter (where bdr.required = true and bdr.status != 'received') as blockers,
  count(bui.id) filter (where bui.status = 'unmatched') as unmatched_uploads,
  
  -- SLA risk (optional: requires due_at field)
  count(bdr.id) filter (
    where bdr.status != 'received' 
      and bdr.due_at is not null 
      and bdr.due_at < now()
  ) as overdue_count,
  
  -- Metadata
  max(bdr.updated_at) as last_activity,
  min(bdr.created_at) as pack_applied_at

from public.deals d
left join public.borrower_document_requests bdr 
  on bdr.deal_id = d.id
left join public.borrower_upload_inbox bui 
  on bui.deal_id = d.id

group by d.id, d.bank_id;

-- ------------------------------------------------------------
-- D) Grant permissions (adjust based on your RLS setup)
-- ------------------------------------------------------------
-- Bankers can read all pack data
-- Borrowers can only see progress view (safe)
-- Adjust these based on your existing RLS policies

-- Example: Allow authenticated users to read pack applications
-- grant select on public.borrower_pack_applications to authenticated;
-- grant select on public.borrower_pack_confidence_summary to authenticated;
-- grant select on public.borrower_progress_and_risk to authenticated;

commit;
