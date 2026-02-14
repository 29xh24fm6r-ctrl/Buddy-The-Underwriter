-- Phase 13: Per-bank registry pinning
-- Allows banks to be locked to specific registry versions

CREATE TABLE IF NOT EXISTS bank_registry_pins (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id             UUID NOT NULL REFERENCES banks(id) ON DELETE CASCADE,
  registry_version_id UUID NOT NULL REFERENCES metric_registry_versions(id) ON DELETE RESTRICT,
  pinned_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  pinned_by           UUID,
  reason              TEXT,
  UNIQUE(bank_id)
);

-- RLS: service role only (admin operations)
ALTER TABLE bank_registry_pins ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_bank_registry_pins_bank_id
  ON bank_registry_pins(bank_id);

CREATE INDEX IF NOT EXISTS idx_bank_registry_pins_version_id
  ON bank_registry_pins(registry_version_id);
