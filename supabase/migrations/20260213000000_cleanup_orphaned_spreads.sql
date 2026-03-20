-- Spread Version Alignment — Orphan Cleanup
--
-- enqueueSpreadRecompute.ts previously hardcoded spread_version=1 for all
-- placeholders, but templates like T12, RENT_ROLL, GLOBAL_CASH_FLOW have
-- version=3. This created orphaned v1 rows that coexisted with v3 rendered
-- rows (unique key includes spread_version), staying stuck forever in
-- "queued" or "generating" and triggering Aegis findings.
--
-- This migration supersedes (not deletes) stale lower-version rows and
-- resolves only the Aegis findings tied to those specific rows.

-- 1) Mark stale lower-version rows as superseded when a newer version exists
--    for the same (deal_id, bank_id, spread_type, owner_type, owner_entity_id).
--    No hardcoded type lists — generic, deterministic.
UPDATE deal_spreads stale
SET status = 'error',
    error_code = 'SUPERSEDED_BY_NEWER_VERSION',
    error = CONCAT(
      'Superseded by spread_version ',
      newer.spread_version,
      ' for same deal/type/owner. stale_version=',
      stale.spread_version
    ),
    finished_at = COALESCE(stale.finished_at, NOW()),
    updated_at = NOW()
FROM deal_spreads newer
WHERE stale.deal_id = newer.deal_id
  AND stale.bank_id = newer.bank_id
  AND stale.spread_type = newer.spread_type
  AND stale.owner_type = newer.owner_type
  AND stale.owner_entity_id = newer.owner_entity_id
  AND stale.spread_version < newer.spread_version
  AND stale.status IN ('queued', 'generating', 'ready', 'error');

-- 2) Scoped Aegis resolution — only resolve findings whose payload->>'spread_id'
--    references a now-superseded row. All other open findings are untouched.
UPDATE buddy_system_events bse
SET resolution_status = 'resolved',
    resolved_at = NOW(),
    resolved_by = 'system:spread_version_cleanup',
    resolution_note = CONCAT(
      'Spread row superseded by newer version. spread_type=',
      bse.payload->>'spread_type'
    )
FROM deal_spreads ds
WHERE bse.resolution_status IN ('open', 'retrying')
  AND bse.event_type IN ('stuck_job', 'warning')
  AND bse.payload->>'spread_id' IS NOT NULL
  AND bse.payload->>'spread_id' = ds.id::text
  AND ds.error_code = 'SUPERSEDED_BY_NEWER_VERSION';
