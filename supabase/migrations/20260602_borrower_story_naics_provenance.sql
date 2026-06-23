-- SPEC-NAICS-TOOL-MEMO-INPUTS-INTEGRATION-1
--
-- Companion to 20260602_borrower_story_industry_naics.sql (which added
-- industry_classification / naics_code / naics_description). When the banker
-- sets the industry/NAICS via Buddy's NAICS suggestion tool inside Memo Inputs,
-- we also record provenance so the UI can distinguish an AI-suggested code from
-- a manually-entered one and surface the model's confidence.
--
-- naics_source:     "suggested" | "manual" (free text, nullable)
-- naics_confidence: 0.0–1.0 from /recovery/naics-suggest (nullable)
--
-- Nullable only. No backfill. The canonical NAICS source remains
-- borrowers.naics_code when a borrower row is attached.

alter table public.deal_borrower_story
  add column if not exists naics_source text,
  add column if not exists naics_confidence numeric;
