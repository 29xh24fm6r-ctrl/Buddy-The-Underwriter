-- SPEC-MEMO-INPUTS-INDUSTRY-CLASSIFICATION-FIELD-1
--
-- The research subject lock (and the flight-deck advisory) can tell a banker to
-- "Set industry classification / NAICS" and deep-link to /deals/[dealId]/memo-inputs,
-- but the Borrower Story had no field to capture it. deal_borrower_story had no
-- industry/NAICS column and no structured JSON column, so the smallest safe
-- persistence is three nullable text columns on the existing row (one per deal).
--
-- These feed buildResearchSubject (deal_borrower_story is read for borrower_id-null
-- deals); the canonical NAICS source remains borrowers.naics_code when a borrower
-- row is attached.

alter table public.deal_borrower_story
  add column if not exists industry_classification text,
  add column if not exists naics_code text,
  add column if not exists naics_description text;
