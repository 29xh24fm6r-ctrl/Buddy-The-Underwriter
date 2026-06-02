-- SPEC-RESEARCH-GATE-PRIVATE-BORROWER-AND-EVIDENCE-PACK-1
--
-- Deal-level entity identity for borrower_id=null deals. The research engine
-- needs a real legal/DBA/website search name to avoid externally "verifying" a
-- placeholder deal label (e.g. "OmniCare Deal Review"), and a banker-certified
-- identity summary to run the private-company research path. The canonical
-- source remains the `borrowers` row when one is attached; these columns are the
-- fallback the banker fills in from Memo Inputs when no borrower row exists.
--
-- Nullable only. No backfill. Pairs with the NAICS columns from
-- SPEC-MEMO-INPUTS-INDUSTRY-CLASSIFICATION-FIELD-1 /
-- SPEC-NAICS-TOOL-MEMO-INPUTS-INTEGRATION-1.

alter table public.deal_borrower_story
  add column if not exists legal_name text,
  add column if not exists dba text,
  add column if not exists website text,
  add column if not exists hq_city text,
  add column if not exists hq_state text,
  add column if not exists banker_identity_summary text;
