BEGIN;

-- ============================================================
-- Fix: a visual fill-test of Form 1919 (fill fake data, render, look at
-- the actual PDF page-by-page) caught that q5Yes/q5No's own /TU tooltip
-- is stale on the real PDF — it describes a "fee paid to the CDC" (504)
-- question, but confirmed by page position (q5 sits directly above the
-- export-sales sub-fields, which sit directly above q6) and the
-- rendered visual itself, the real printed Question 5 is "Are any of
-- the Applicant's products/services exported...", not a fee question.
-- There is no separate CDC-fee question on this (7(a)) revision of the
-- form at all — 504 loans use the separate SBA Form 1244, not this one.
--
-- The prior migration added a `fee_paid_to_cdc_or_broker` column
-- assuming that variant existed; it's harmless to leave in place (0
-- rows, unreferenced) in case a future 504-specific form needs it, but
-- Form 1919 needs a real yes/no gate for the export question instead,
-- which nothing so far provided (export_sales_total alone can't
-- distinguish "asked and the answer is no exports" from "not asked
-- yet").
-- ============================================================

ALTER TABLE public.ownership_entities
  ADD COLUMN IF NOT EXISTS has_export_sales boolean;

COMMENT ON COLUMN public.ownership_entities.has_export_sales IS
  'SBA Form 1919 Section II Q5 — are any products/services exported (or planned to be, or is this an EWCP loan)? Gates whether export_sales_total/export_country_* are shown as applicable.';

COMMIT;
