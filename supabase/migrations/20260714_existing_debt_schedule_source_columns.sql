-- SPEC-BROKERAGE-SBA-READY-V1 debt-schedule-wiring follow-up.
--
-- deal_existing_debt_schedule already exists (banker-facing manual entry,
-- consumed by computeTotalDebtService.ts). This adds the columns needed to:
--   (a) let a Brokerage borrower enter their own existing debt (source
--       distinguishes who entered it), and
--   (b) drop in a future Plaid-driven auto-builder (buildDebtSchedule() in
--       src/lib/financialFacts/debtScheduleAutoBuilder.ts) without another
--       migration — its DebtScheduleEntry.confidence maps straight onto the
--       new confidence column, and its account_type_inferred already maps
--       onto the existing loan_type column.
--
-- Additive only. No existing column altered or dropped.

ALTER TABLE public.deal_existing_debt_schedule
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual_banker'
    CHECK (source IN ('manual_banker', 'manual_borrower', 'plaid_auto')),
  ADD COLUMN IF NOT EXISTS confidence numeric;

COMMENT ON COLUMN public.deal_existing_debt_schedule.source IS
  'Who/what produced this row. manual_banker: existing Underwriter-cockpit entry API (default, preserves prior rows'' meaning). manual_borrower: Brokerage borrower-facing entry API. plaid_auto: future debtScheduleAutoBuilder.ts output, not yet wired to a live Plaid connection.';
COMMENT ON COLUMN public.deal_existing_debt_schedule.confidence IS
  'Only meaningful for source=plaid_auto — mirrors DebtScheduleEntry.confidence from debtScheduleAutoBuilder.ts (0-1). Null for manually-entered rows, which carry no inference uncertainty.';
