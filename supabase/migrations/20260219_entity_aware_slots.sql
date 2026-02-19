-- ---------------------------------------------------------------------------
-- Phase 15B+ — Entity-Aware Slots
-- ---------------------------------------------------------------------------
-- Adds optional entity columns to deal_document_slots so slot policies can
-- target specific entities (e.g. PFS per guarantor, BTR per opco).
-- Existing slots with NULL values work exactly as before.

ALTER TABLE deal_document_slots
  ADD COLUMN IF NOT EXISTS required_entity_id UUID,
  ADD COLUMN IF NOT EXISTS required_entity_role TEXT;

CREATE INDEX IF NOT EXISTS idx_slots_entity
  ON deal_document_slots(deal_id, required_entity_role, required_entity_id);
