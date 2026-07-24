-- Restores deal_truth_snapshots to the schema its own consumers expect.
--
-- Root cause: migration 20251227000002_agent_arbitration.sql (checked into
-- this repo) defines a full deal_truth_snapshots table — bank_id, truth_json,
-- version, total_claims, resolved_claims, needs_human, overall_confidence,
-- bank_overlay_id, bank_overlay_version, created_by, plus indexes and a
-- deal_id FK — and every real consumer (arbitration/materialize's writer,
-- policyEngine.ts, etran/generator.ts, flagEngine, credit-memo export,
-- autopilot/status, arbitration/status) codes against exactly that shape.
--
-- At some point an UNTRACKED migration ("20260519201643_create_deal_truth_
-- snapshots_stub", recorded in supabase_migrations.schema_migrations but
-- never committed to this repo) recreated the table down to just
-- (id, deal_id, created_at) — presumably a minimal placeholder for the
-- handful of consumers that only ever did an existence/count check
-- (gap-queue, builderGateValidation, runAutoIntelligencePipeline). That
-- silently broke every other consumer, including etran/generator.ts's own
-- read path (see the accompanying code fix for generator.ts's separate
-- truth vs. truth_json column-name bug).
--
-- The table has 0 rows in every environment this was checked against, so
-- adding NOT NULL columns here needs no backfill.
--
-- This migration restores schema parity only. It does NOT build the
-- truth-snapshot writer subsystem's dependencies (arbitration_decisions,
-- bank_overlays) — those tables don't exist in this database either, so
-- the one real writer (POST /arbitration/materialize) still cannot run
-- end-to-end until that separate, materially larger effort is done. That
-- gap is out of scope here (matches the Drift Log's own disposition in
-- specs/sba-30min-package/ARC-00-forms-complete-build-arc.md).

ALTER TABLE deal_truth_snapshots
  ADD COLUMN IF NOT EXISTS bank_id uuid,
  ADD COLUMN IF NOT EXISTS truth_json jsonb,
  ADD COLUMN IF NOT EXISTS version int,
  ADD COLUMN IF NOT EXISTS total_claims int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolved_claims int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS needs_human int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS overall_confidence numeric(3,2),
  ADD COLUMN IF NOT EXISTS bank_overlay_id uuid,
  ADD COLUMN IF NOT EXISTS bank_overlay_version int,
  ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT 'system';

-- bank_id/truth_json/version added nullable above (ALTER ... ADD COLUMN
-- with NOT NULL and no default fails on Postgres even against an empty
-- table in some engines' migration tooling); enforce NOT NULL separately
-- now that the table is confirmed empty.
ALTER TABLE deal_truth_snapshots
  ALTER COLUMN bank_id SET NOT NULL,
  ALTER COLUMN truth_json SET NOT NULL,
  ALTER COLUMN version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deal_truth_snapshots_bank_id_fkey'
  ) THEN
    ALTER TABLE deal_truth_snapshots
      ADD CONSTRAINT deal_truth_snapshots_bank_id_fkey FOREIGN KEY (bank_id) REFERENCES banks(id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deal_truth_snapshots_deal_id_fkey'
  ) THEN
    ALTER TABLE deal_truth_snapshots
      ADD CONSTRAINT deal_truth_snapshots_deal_id_fkey FOREIGN KEY (deal_id) REFERENCES deals(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'deal_truth_snapshots_bank_id_check'
  ) THEN
    ALTER TABLE deal_truth_snapshots
      ADD CONSTRAINT deal_truth_snapshots_bank_id_check CHECK (bank_id IS NOT NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_deal_truth_deal_id ON deal_truth_snapshots(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_truth_version ON deal_truth_snapshots(deal_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_deal_truth_created_at ON deal_truth_snapshots(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deal_truth_json ON deal_truth_snapshots USING gin(truth_json);

COMMENT ON TABLE deal_truth_snapshots IS 'Versioned snapshots of deal truth - what we believe at this moment';
COMMENT ON COLUMN deal_truth_snapshots.truth_json IS 'Compiled key-value pairs from all arbitrated decisions';
COMMENT ON COLUMN deal_truth_snapshots.version IS 'Monotonically increasing version number';
