-- Rotation cursor for the brokerage comms batch.
--
-- Documentation only. This migration was applied to production via the Supabase
-- MCP apply_migration path, which is this repo's sole application path for DDL.
--
-- runBrokerageCommsBatch used to order active deals by created_at desc and take
-- the first N on every run, so the same newest N deals were re-processed every
-- ten minutes and every deal ranked past N never received a borrower nudge or a
-- banker alert at all. Production bore this out exactly: 41 active deals, 25
-- ever contacted, and the 16 ranked past the limit had zero messages after eight
-- days and roughly 1,150 cron runs.
--
-- This column is the round-robin cursor: the batch stamps it per deal and orders
-- by it ascending, nulls first, so never-contacted deals go to the head of the
-- queue and the batch walks the whole active set.
--
-- Nullable with no default on purpose: a null means "never processed", which is
-- exactly the sort key that puts a brand new deal first.
alter table public.deals
  add column if not exists brokerage_comms_last_run_at timestamptz;

comment on column public.deals.brokerage_comms_last_run_at is
  'Last time the brokerage comms batch processed this deal. Round-robin cursor for runBrokerageCommsBatch; null means never processed and sorts first.';

-- Supports the batch ordering (nulls first, oldest first).
create index if not exists deals_brokerage_comms_last_run_at_idx
  on public.deals (brokerage_comms_last_run_at asc nulls first);
