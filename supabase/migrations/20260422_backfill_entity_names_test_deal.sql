-- Spec D1 — Backfill: clear gatekeeper fingerprints on the active Samaritus
-- test deal so the next classification cycle picks up the new v2 prompt and
-- populates ai_business_name / ai_borrower_name. Idempotent: updates zero
-- rows if the deal has already been deleted.
--
-- Target: "Test Deal 4-22-26 #1" (intake_phase = PROCESSING_COMPLETE as of
-- 2026-04-22 12:15 UTC, per Supabase MCP verification).
--
-- Post-migration: trigger a manual reclassification via
-- POST /api/deals/{dealId}/reprocess-documents (admin panel).

UPDATE deal_documents
SET
  gatekeeper_classified_at = NULL,
  gatekeeper_prompt_hash = NULL,
  gatekeeper_prompt_version = NULL
WHERE deal_id = 'd65cc19e-b03e-4f2d-89ce-95ee69472cf3';
