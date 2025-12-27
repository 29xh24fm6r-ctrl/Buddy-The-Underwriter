-- 20251227_add_kind_to_ai_events.sql
-- Add 'kind' column to ai_events for event taxonomy
-- Supports event-sourced underwriting OS (borrower.connect.completed, preapproval.result, etc.)

begin;

-- Add kind column (nullable initially for existing rows)
alter table public.ai_events 
add column if not exists kind text null;

-- Create index for kind-based queries
create index if not exists idx_ai_events_kind 
on public.ai_events(kind);

-- Add composite index for deal_id + kind (common query pattern)
create index if not exists idx_ai_events_deal_kind 
on public.ai_events(deal_id, kind);

commit;
