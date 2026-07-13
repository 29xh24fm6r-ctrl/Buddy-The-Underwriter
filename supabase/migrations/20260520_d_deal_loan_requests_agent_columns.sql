-- SPEC S4 G-4 TODO: agent_used column didn't exist — confirmed via
-- information_schema before writing this. Drives the conditional Form 159
-- requirement (already built in ARC-00 Phase 0.D; this column lets the
-- package builder decide whether to include it).
BEGIN;
ALTER TABLE public.deal_loan_requests
  ADD COLUMN IF NOT EXISTS agent_used boolean;
COMMIT;
