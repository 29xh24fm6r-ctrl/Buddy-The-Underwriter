begin;

-- ============================================================
-- Pack Learning System - Add auto_applied event type
-- ============================================================

-- Update the event_type constraint to include 'auto_applied'
alter table public.borrower_pack_learning_events 
  drop constraint if exists borrower_pack_learning_events_event_type_check;

alter table public.borrower_pack_learning_events 
  add constraint borrower_pack_learning_events_event_type_check 
  check (event_type in (
    'upload_matched',
    'upload_missed',
    'requirement_cleared',
    'sla_breached',
    'override',
    'completion',
    'auto_applied'
  ));

commit;
