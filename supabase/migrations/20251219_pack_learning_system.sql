begin;

-- ============================================================
-- Pack Learning System (Sprint Ω)
-- ============================================================
-- Auto-apply confidence + ranking + learning + override
-- All metadata-driven, append-only, canonical-safe.
-- ============================================================

-- ------------------------------------------------------------
-- A) Pack Match Events (when a pack is matched to a deal)
-- ------------------------------------------------------------
create table if not exists public.borrower_pack_match_events (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  deal_id uuid not null references public.deals(id) on delete cascade,
  pack_id uuid not null references public.borrower_pack_templates(id) on delete cascade,
  
  match_score int not null, -- 0-100 from scorePackMatch()
  auto_applied boolean not null default false,
  suggested boolean not null default false,
  manually_applied boolean not null default false,
  
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists borrower_pack_match_events_deal_id_idx 
  on public.borrower_pack_match_events(deal_id);
create index if not exists borrower_pack_match_events_pack_id_idx 
  on public.borrower_pack_match_events(pack_id);
create index if not exists borrower_pack_match_events_bank_id_idx 
  on public.borrower_pack_match_events(bank_id);

-- ------------------------------------------------------------
-- B) Pack Learning Events (append-only outcome tracking)
-- ------------------------------------------------------------
create table if not exists public.borrower_pack_learning_events (
  id uuid primary key default gen_random_uuid(),
  bank_id uuid not null,
  match_event_id uuid not null references public.borrower_pack_match_events(id) on delete cascade,
  
  event_type text not null check (event_type in (
    'upload_matched',
    'upload_missed',
    'requirement_cleared',
    'sla_breached',
    'override',
    'completion'
  )),
  
  metadata jsonb not null default '{}'::jsonb,
  -- Expected metadata keys:
  -- matched: boolean
  -- landed_in_inbox: boolean
  -- blockers: int
  -- days_to_complete: int
  -- overridden: boolean
  -- override_reason: text
  
  created_at timestamptz not null default now()
);

create index if not exists borrower_pack_learning_events_match_event_id_idx 
  on public.borrower_pack_learning_events(match_event_id);
create index if not exists borrower_pack_learning_events_bank_id_idx 
  on public.borrower_pack_learning_events(bank_id);
create index if not exists borrower_pack_learning_events_event_type_idx 
  on public.borrower_pack_learning_events(event_type);
create index if not exists borrower_pack_learning_events_created_at_idx 
  on public.borrower_pack_learning_events(created_at);

-- ------------------------------------------------------------
-- C) Pack Confidence View (auto/suggest/manual decision)
-- ------------------------------------------------------------
create or replace view public.borrower_pack_confidence as
select
  pt.id as pack_template_id,
  pt.bank_id,
  pt.name as pack_name,
  
  count(distinct me.id) as sample_size,
  
  avg(coalesce((le.metadata->>'blockers')::int, 0)) as avg_blockers,
  avg(coalesce((le.metadata->>'days_to_complete')::int, 0)) as avg_days,
  
  -- Override rate (0.0 - 1.0)
  avg(
    case when le.event_type = 'override' 
    then 1.0 
    else 0.0 
    end
  ) as override_rate,
  
  -- Confidence level decision
  case
    when count(distinct me.id) >= 10
     and avg(coalesce((le.metadata->>'blockers')::int, 0)) <= 1
     and avg(
       case when le.event_type = 'override' 
       then 1.0 
       else 0.0 
       end
     ) < 0.2
    then 'auto'
    
    when count(distinct me.id) >= 5
    then 'suggest'
    
    else 'manual'
  end as confidence_level

from public.borrower_pack_templates pt
left join public.borrower_pack_match_events me on me.pack_id = pt.id
left join public.borrower_pack_learning_events le on le.match_event_id = me.id

group by pt.id, pt.bank_id, pt.name;

-- ------------------------------------------------------------
-- D) Pack Rankings (deal-aware, not global)
-- ------------------------------------------------------------
create or replace view public.borrower_pack_rankings as
select
  me.deal_id,
  me.bank_id,
  pt.id as pack_template_id,
  pt.name as pack_name,
  
  me.match_score,
  
  count(distinct le.id) as learning_events,
  avg(coalesce((le.metadata->>'blockers')::int, 0)) as avg_blockers,
  
  -- Rank per deal (1 = best)
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
-- E) Pack Effectiveness (cross-bank intelligence)
-- ------------------------------------------------------------
create or replace view public.borrower_pack_effectiveness as
select
  pt.id as pack_template_id,
  pt.bank_id,
  pt.name as pack_name,
  pt.loan_type,
  pt.loan_program,
  
  count(distinct me.id) as times_applied,
  count(distinct me.deal_id) as unique_deals,
  
  avg(me.match_score) as avg_match_score,
  
  count(distinct case when le.event_type = 'override' then me.id end) as override_count,
  count(distinct case when le.event_type = 'completion' then me.id end) as completion_count,
  
  avg(coalesce((le.metadata->>'blockers')::int, 0)) as avg_blockers,
  avg(coalesce((le.metadata->>'days_to_complete')::int, 0)) as avg_days_to_complete,
  
  -- Success rate (completions / times applied)
  case 
    when count(distinct me.id) > 0
    then count(distinct case when le.event_type = 'completion' then me.id end)::float / count(distinct me.id)
    else 0
  end as success_rate

from public.borrower_pack_templates pt
left join public.borrower_pack_match_events me on me.pack_id = pt.id
left join public.borrower_pack_learning_events le on le.match_event_id = me.id

group by pt.id, pt.bank_id, pt.name, pt.loan_type, pt.loan_program;

commit;
