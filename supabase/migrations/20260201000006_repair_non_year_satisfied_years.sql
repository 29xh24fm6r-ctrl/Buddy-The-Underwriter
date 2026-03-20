-- =========================================================
-- Repair: clear spurious satisfied_years on non-year checklist items
--
-- Non-year items (PFS_CURRENT, AR_AP_AGING, BANK_STMT_3M, SBA_*)
-- should never have satisfied_years populated. The year-extraction
-- regex was leaking spurious years (e.g. "2001" from metadata)
-- into these items, causing phantom "Received" counts in the UI.
--
-- This is idempotent and safe to re-run.
-- =========================================================

update public.deal_checklist_items
set satisfied_years = '{}'
where checklist_key not like 'IRS_%'
  and checklist_key not like 'FIN_STMT_%'
  and satisfied_years is not null
  and cardinality(satisfied_years) > 0;
